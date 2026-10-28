import { BadRequestException, ConflictException } from '@nestjs/common';
/* eslint-disable @typescript-eslint/require-await */
import { ConfigService } from '@nestjs/config';
import { OrdersService } from './orders.service';
import { FirebaseService } from '../firebase/firebase.service';
import { PricingService } from '../pricing/pricing.service';
import { ServiceAreaService } from '../service-area/service-area.service';
import { CreateOrderDto } from './dto/orders.dto';
jest.mock('../firebase/firebase.service', () => ({
  FirebaseService: class {},
}));

const merchant = {
  merchantId: 'merchant',
  ownerUid: 'owner',
  status: 'approved',
  displayName: 'Shop',
};
const outlet = {
  active: true,
  name: 'Central',
  address: 'Saved address',
  city: 'Oslo',
  countryCode: 'NO',
  latitude: 59.91,
  longitude: 10.75,
  contactName: 'Manager',
  contactPhone: '+4712345678',
};
function fixture(
  saved: Record<string, unknown> | null,
  current: Record<string, unknown> | null = saved,
) {
  const writes: Array<{ ref: unknown; data: Record<string, unknown> }> = [];
  const outletGet = jest.fn(async () => ({
    exists: !!saved,
    data: () => saved,
  }));
  const outletDoc = jest.fn(() => ({ get: outletGet }));
  const merchantDoc = jest.fn(() => ({
    get: async () => ({
      exists: true,
      data: () => ({ status: 'approved', name: 'Shop' }),
      ref: { set: async () => {} },
    }),
    collection: () => ({ doc: outletDoc }),
  }));
  const orderRef = {
    id: 'order',
    collection: () => ({ doc: () => ({ id: 'event', set: async () => {} }) }),
  };
  const transaction = {
    get: jest.fn(async () => ({
      exists: true,
      data: () =>
        transaction.get.mock.calls.length === 1
          ? { status: 'approved' }
          : current,
    })),
    set: (ref: unknown, data: Record<string, unknown>) => {
      writes.push({ ref, data });
    },
  };
  const firebase = {
    serverTimestamp: () => 'now',
    increment: (amount: number) => amount,
    db: {
      collection: (name: string) => ({
        doc: name === 'merchantprofiles' ? merchantDoc : () => orderRef,
      }),
      runTransaction: async (
        callback: (tx: typeof transaction) => Promise<void>,
      ) => callback(transaction),
    },
  };
  const pricing = {
    previewRoute: jest.fn(async () => ({
      pickup: { lat: 59.91, lng: 10.75 },
      dropoff: { lat: 59.92, lng: 10.76 },
      route: {},
      pricing: { total: 100 },
    })),
    generateDropoffPin: () => '1234',
  };
  const area = {
    ensureLoaded: async () => {},
    validateOrderStops: jest.fn(() => null),
    classifyStops: () => ({ scope: 'within_city' }),
  };
  const service = new OrdersService(
    firebase as unknown as FirebaseService,
    pricing as unknown as PricingService,
    area as unknown as ServiceAreaService,
    { get: () => 'https://example.com' } as unknown as ConfigService,
  );
  return { service, pricing, area, writes, merchantDoc, outletDoc };
}
const dto = {
  outletId: 'central',
  pickup: {
    formatted: 'Caller address',
    city: 'Fake city',
    countryCode: 'NO',
    lat: 1,
    lng: 2,
  },
  dropoff: { formatted: 'Dropoff', city: 'Oslo', countryCode: 'NO' },
  pickupContact: { name: 'Manager', phone: '+4712345678' },
  dropoffContact: { name: 'Customer', phone: '+4712345678' },
  itemDescription: 'Test package',
  receiptUrl: 'https://example.com/r',
  pickupAuthorizationGranted: true,
} as CreateOrderDto;
describe('outlet order creation', () => {
  it('uses saved owned outlet location and immutable attribution, not caller pickup coordinates', async () => {
    const { service, pricing, area, writes, merchantDoc, outletDoc } =
      fixture(outlet);
    await service.createOrder(merchant, dto);
    expect(merchantDoc).toHaveBeenCalledWith('merchant');
    expect(outletDoc).toHaveBeenCalledWith('central');
    expect(pricing.previewRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        pickupAddress: 'Saved address',
        pickupLat: 59.91,
        pickupLng: 10.75,
      }),
    );
    expect(area.validateOrderStops).toHaveBeenCalledWith(
      expect.objectContaining({ pickupCity: 'Oslo' }),
    );
    expect(writes[0].data.source).toMatchObject({
      outletId: 'central',
      outletName: 'Central',
    });
  });
  it.each([
    null,
    { ...outlet, active: false },
    { ...outlet, latitude: 91 },
    { ...outlet, city: '' },
  ])(
    'rejects unavailable or invalid outlet before creating an order (%p)',
    async (saved) => {
      const { service, writes } = fixture(saved);
      await expect(service.createOrder(merchant, dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(writes).toEqual([]);
    },
  );
  it('uses outlet contact details when the API request has no pickup fields', async () => {
    const { service, writes } = fixture(outlet);
    await service.createOrder(merchant, {
      ...dto,
      pickup: undefined,
      pickupContact: undefined,
    } as unknown as CreateOrderDto);
    expect(writes[0].data.pickup).toMatchObject({
      address: { formatted: 'Saved address' },
      contact: { name: 'Manager', phone: '+4712345678' },
    });
    expect(writes).toHaveLength(4);
  });
  it.each([
    null,
    { ...outlet, active: false },
    { ...outlet, address: 'Changed address' },
  ])(
    'rechecks outlet state transactionally before committing (%p)',
    async (current) => {
      const { service, writes } = fixture(outlet, current);
      await expect(service.createOrder(merchant, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(writes).toEqual([]);
    },
  );
  it('keeps manual pickup orders compatible', async () => {
    const { service, pricing, writes } = fixture(null);
    await service.createOrder(merchant, { ...dto, outletId: undefined });
    expect(pricing.previewRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        pickupAddress: 'Caller address',
        pickupLat: 1,
        pickupLng: 2,
      }),
    );
    expect(writes[0].data.source).toMatchObject({
      outletId: null,
      outletName: null,
    });
  });
});
