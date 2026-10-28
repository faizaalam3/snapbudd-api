/* eslint-disable @typescript-eslint/require-await */
import { ConfigService } from '@nestjs/config';
import { PricingService } from './pricing.service';
import { DEFAULT_POLICY } from './pricing-policy.cjs';
jest.mock('../firebase/firebase.service', () => ({
  FirebaseService: class {},
}));

const service = () =>
  new PricingService(
    {
      get: (name: string, fallback: unknown) =>
        name === 'googleMapsApiKey' ? 'test-key' : fallback,
    } as ConfigService,
    {
      db: {
        collection: () => ({
          doc: () => ({ get: async () => ({ exists: false }) }),
        }),
      },
    } as unknown as import('../firebase/firebase.service').FirebaseService,
  );
describe('customer-compatible delivery estimates', () => {
  it.each([
    [19, 'Small', 'Car', 140],
    [19.01, 'Small', 'Car', 200],
    [39, 'Medium', 'Car', 340],
    [39.01, 'Medium', 'Car', 450],
    [90, 'Large', 'Van', 970],
    [10, 'Small', 'Bike', 110],
  ])(
    'calculates %s km / %s / %s as NOK %s',
    (distanceKm, packageSize, vehicleType, expected) => {
      const result = service().calculatePricing({
        distanceKm,
        packageSize,
        vehicleType,
      });
      expect(result.total).toBe(expected);
      expect(result.suggestedTotal).toBe(expected);
      expect(result.maxOffer).toBe(expected * 3);
    },
  );
  it('rejects unavailable distance rather than returning a zero estimate', () => {
    expect(() =>
      service().calculatePricing({
        distanceKm: 0,
        packageSize: 'Small',
        vehicleType: 'Car',
      }),
    ).toThrow();
  });
  it('uses driving distance and fails closed when routing is unavailable', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    try {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'OK',
          routes: [
            {
              legs: [{ distance: { value: 40000 }, duration: { value: 2400 } }],
            },
          ],
        }),
      } as Response);
      const input = {
        pickupAddress: 'Pickup',
        dropoffAddress: 'Dropoff',
        pickupLat: 59.9,
        pickupLng: 10.7,
        dropoffLat: 59.91,
        dropoffLng: 10.71,
        packageSize: 'Medium',
        vehicleType: 'Car',
      };
      const result = await service().previewRoute(input);
      expect(result.route.distanceKm).toBe(40);
      expect(result.pricing.total).toBe(450);
      const requestUrl = fetchMock.mock.calls[0]?.[0];
      expect(typeof requestUrl === 'string' ? requestUrl : '').toContain(
        'mode=driving',
      );
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ZERO_RESULTS' }),
      } as Response);
      await expect(service().previewRoute(input)).rejects.toThrow(
        'Cannot estimate',
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe('live admin pricing policy', () => {
  it('reads the current Firestore document for each new estimate', async () => {
    let active = structuredClone(DEFAULT_POLICY);
    const firebase = {
      db: {
        collection: () => ({
          doc: () => ({
            get: async () => ({ exists: true, data: () => active }),
          }),
        }),
      },
    };
    const pricing = new PricingService(
      { get: (_key: string, fallback: unknown) => fallback } as ConfigService,
      firebase as unknown as import('../firebase/firebase.service').FirebaseService,
    );
    const input = { distanceKm: 10, packageSize: 'Small', vehicleType: 'Car' };
    expect(
      pricing.calculatePricing(input, await pricing.activePolicy()).total,
    ).toBe(140);
    active = { ...active, revision: 2, fees: { ...active.fees, fixedNok: 49 } };
    const next = pricing.calculatePricing(input, await pricing.activePolicy());
    expect(next.total).toBe(160);
    expect(next.pricingRevision).toBe(2);
    expect(next.feeRates.fixedNok).toBe(49);
  });
});
