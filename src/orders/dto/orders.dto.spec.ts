import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderDto } from './orders.dto';

const payload = () => ({
  pickupAuthorizationGranted: true,
  pickup: {
    formatted: 'Karl Johans gate 1, Oslo',
    city: 'Oslo',
    countryCode: 'NO',
  },
  dropoff: {
    formatted: 'Aker Brygge 10, Oslo',
    city: 'Oslo',
    countryCode: 'NO',
  },
  pickupContact: { name: 'Shop', phone: '+4712345678' },
  dropoffContact: { name: 'Recipient', phone: '+4798765432' },
  itemDescription: 'Blue winter jacket',
  receiptUrl: 'https://example.com/receipt.pdf',
  packageType: 'General',
  packageSize: 'Medium',
  vehicleType: 'Car',
});
const errors = (data: unknown) =>
  validate(plainToInstance(CreateOrderDto, data), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('Order API request contract', () => {
  it('rejects absent or declined pickup consent', async () => {
    expect(
      (await errors({ ...payload(), pickupAuthorizationGranted: undefined }))
        .length,
    ).toBeGreaterThan(0);
    expect(
      (await errors({ ...payload(), pickupAuthorizationGranted: false }))
        .length,
    ).toBeGreaterThan(0);
  });
  it('accepts the documented payload', async () => {
    expect(await errors(payload())).toEqual([]);
  });
  it('allows an outlet to supply pickup address and contact, but still validates supplied overrides', async () => {
    const data: Record<string, unknown> = { ...payload(), outletId: 'central' };
    delete data.pickup;
    delete data.pickupContact;
    expect(await errors(data)).toEqual([]);
    expect(
      (await errors({ ...data, pickupContact: { phone: '' } })).length,
    ).toBeGreaterThan(0);
    expect(
      (await errors({ ...data, outletId: '../other' })).length,
    ).toBeGreaterThan(0);
  });
  it.each(['pickup', 'dropoff', 'pickupContact', 'dropoffContact'])(
    'requires %s',
    async (field) => {
      const data: Record<string, unknown> = payload();
      delete data[field];
      expect(
        (await errors(data)).some((error) => error.property === field),
      ).toBe(true);
    },
  );
  it('rejects invalid coordinates and country codes', async () => {
    expect(
      (
        await errors({
          ...payload(),
          pickup: {
            ...payload().pickup,
            lat: 91,
            lng: 181,
            countryCode: 'NOR',
          },
        })
      ).length,
    ).toBeGreaterThan(0);
  });
  it('rejects invalid calendar dates and accepts ISO timestamps', async () => {
    expect(
      (await errors({ ...payload(), scheduledAt: '2026-02-30T10:00:00Z' }))
        .length,
    ).toBeGreaterThan(0);
    expect(
      await errors({ ...payload(), scheduledAt: '2026-10-01T10:00:00Z' }),
    ).toEqual([]);
  });
  it('rejects unknown fields and noncanonical enum values', async () => {
    expect(
      (
        await errors({
          ...payload(),
          packageType: 'general',
          driverId: 'injected',
        })
      ).length,
    ).toBeGreaterThan(0);
  });
});
