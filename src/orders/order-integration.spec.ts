/* eslint-disable @typescript-eslint/require-await -- Async service test doubles. */
import { BadRequestException } from '@nestjs/common';
import {
  nearestOutlet,
  requestHash,
  trackingReference,
} from './order-integration';
import { OrdersService } from './orders.service';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../firebase/firebase.service';
import { PricingService } from '../pricing/pricing.service';
import { ServiceAreaService } from '../service-area/service-area.service';
import { CreateOrderDto } from './dto/orders.dto';
jest.mock('../firebase/firebase.service', () => ({
  FirebaseService: class {},
}));

const outlet = {
  active: true,
  address: 'Oslo',
  city: 'Oslo',
  countryCode: 'NO',
  contactPhone: '+4712345678',
  latitude: 59.91,
  longitude: 10.75,
};
it('selects the nearest complete active outlet, with stable ties and no inactive fallback', () => {
  expect(
    nearestOutlet(
      [
        { ...outlet, id: 'closed', active: false },
        { ...outlet, id: 'far', longitude: 11 },
        { ...outlet, id: 'near' },
        { ...outlet, id: 'incomplete', contactPhone: '' },
      ],
      59.91,
      10.75,
    ),
  ).toBe('near');
  expect(
    nearestOutlet(
      [
        { ...outlet, id: 'b' },
        { ...outlet, id: 'a' },
      ],
      59.91,
      10.75,
    ),
  ).toBe('a');
  expect(() =>
    nearestOutlet([{ ...outlet, id: 'closed', active: false }], 59.91, 10.75),
  ).toThrow(BadRequestException);
  expect(() =>
    nearestOutlet([{ ...outlet, id: 'near' }], undefined, 10.75),
  ).toThrow(BadRequestException);
});
it('hashes equivalent JSON independently of key order and makes valid tracking references', () => {
  expect(requestHash({ a: 1, b: { x: 2, y: 3 } })).toBe(
    requestHash({ b: { y: 3, x: 2 }, a: 1 }),
  );
  expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 2 }));
  for (let i = 0; i < 100; i++)
    expect(trackingReference()).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
});

function fixture() {
  const store = new Map<string, Record<string, unknown>>([
    ['merchantprofiles/merchant', { status: 'approved', name: 'Store' }],
  ]);
  type Ref = {
    path: string;
    id: string;
    get: () => Promise<ReturnType<typeof snapshot>>;
    collection: (name: string) => { doc: (id?: string) => Ref };
  };
  const snapshot = (ref: Ref) => ({
    id: ref.id,
    ref,
    exists: store.has(ref.path),
    data: () => store.get(ref.path),
  });
  let counter = 0;
  const ref = (path: string): Ref => ({
    path,
    id: path.split('/').at(-1)!,
    get: async () => snapshot(ref(path)),
    collection: (name) => ({
      doc: (id = 'auto' + ++counter) => ref(path + '/' + name + '/' + id),
    }),
  });
  let queue = Promise.resolve();
  const firebase = {
    serverTimestamp: () => 'now',
    increment: () => 1,
    db: {
      collection: (name: string) => ({
        doc: (id = 'auto' + ++counter) => ref(name + '/' + id),
      }),
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const previous = queue;
        let release!: () => void;
        queue = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        const writes: Array<[Ref, Record<string, unknown>]> = [];
        try {
          const result = await fn({
            get: async (r: Ref) => snapshot(r),
            set: (r: Ref, data: Record<string, unknown>) =>
              writes.push([r, data]),
            create: (r: Ref, data: Record<string, unknown>) => {
              if (store.has(r.path)) throw Error('Collision');
              writes.push([r, data]);
            },
          });
          for (const [r, data] of writes)
            store.set(r.path, { ...store.get(r.path), ...data });
          return result;
        } finally {
          release();
        }
      },
    },
  };
  const pricing = {
    previewRoute: async () => ({
      pickup: { lat: 59.91, lng: 10.75 },
      dropoff: { lat: 59.92, lng: 10.76 },
      route: { distanceKm: 3, durationMin: 10 },
      pricing: { total: 100, currency: 'NOK', pricingRevision: 1, discount: 0 },
    }),
    activePolicy: async () => ({ revision: 1 }),
    generateDropoffPin: () => '1234',
  };
  const service = new OrdersService(
    firebase as unknown as FirebaseService,
    pricing as unknown as PricingService,
    {
      ensureLoaded: async () => {},
      validateOrderStops: () => null,
      classifyStops: () => ({}),
    } as unknown as ServiceAreaService,
    { get: () => 'https://snapbudd.io/track' } as unknown as ConfigService,
  );
  const dto: CreateOrderDto = {
    pickupAuthorizationGranted: true,
    pickup: { formatted: 'Pickup', city: 'Oslo', countryCode: 'NO' },
    dropoff: { formatted: 'Dropoff', city: 'Oslo', countryCode: 'NO' },
    pickupContact: { name: 'Desk', phone: '+4712345678' },
    dropoffContact: { name: 'Buyer', phone: '+4798765432' },
    itemDescription: 'Parcel',
    receiptUrl: 'https://example.test/receipt',
  };
  const merchant = {
    merchantId: 'merchant',
    ownerUid: 'owner',
    status: 'approved',
    displayName: 'Store',
  };
  return { service, store, dto, merchant };
}
it('concurrent creates and later retries return one order and one immediately usable tracking mapping', async () => {
  const f = fixture();
  const results = await Promise.all([
    f.service.createOrder(f.merchant, f.dto, 'web-order-123'),
    f.service.createOrder(f.merchant, f.dto, 'web-order-123'),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(
    [...f.store.keys()].filter((k) => /^orders\/[^/]+$/.test(k)),
  ).toHaveLength(1);
  const reference = results[0].trackingId!;
  expect(f.store.get('trackingReferences/' + reference)).toEqual({
    orderId: results[0].orderId,
    collection: 'orders',
  });
  expect(results[0].trackingUrl).toBe('https://snapbudd.io/track/' + reference);
  expect(results[0].status).toBe('payment_pending');
  await expect(
    f.service.createOrder(
      f.merchant,
      { ...f.dto, notes: 'changed' },
      'web-order-123',
    ),
  ).rejects.toThrow('different order details');
  await expect(
    f.service.getOrder(
      { ...f.merchant, merchantId: 'other' },
      results[0].orderId,
    ),
  ).rejects.toThrow('does not belong');
});
