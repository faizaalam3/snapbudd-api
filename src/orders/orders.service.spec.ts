/* eslint-disable @typescript-eslint/require-await */
import { ConfigService } from '@nestjs/config';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { FirebaseService } from '../firebase/firebase.service';
import { PricingService } from '../pricing/pricing.service';
import { ServiceAreaService } from '../service-area/service-area.service';
import type { MerchantContext } from '../common/types/merchant-context';
// These are unit tests: never initialize Firebase or production credentials.
jest.mock('../firebase/firebase.service', () => ({
  FirebaseService: class {},
}));

const merchant: MerchantContext = {
  merchantId: 'shop',
  status: 'approved',
  displayName: 'Shop',
  ownerUid: 'owner',
};
function fixture(
  order: Record<string, unknown>,
  bid: Record<string, unknown> = { status: 'active' },
) {
  const writes: unknown[] = [];
  const orderRef = {
    id: 'order',
    get: async () => ({ exists: true, id: 'order', data: () => order }),
    collection: () => ({
      doc: (id?: string) => ({ id: id || 'event' }),
      get: async () => ({ docs: [] }),
      add: async () => ({}),
    }),
  };
  let reads = 0;
  const tx = {
    get: jest.fn(async () => {
      if (writes.length) throw new Error('Transaction read after write');
      return { exists: true, data: () => (++reads === 1 ? order : bid) };
    }),
    set: jest.fn((...args: unknown[]) => {
      writes.push(args);
    }),
  };
  const firebase = {
    db: {
      collection: () => ({ doc: () => orderRef }),
      batch: () => ({ set: () => {}, commit: async () => {} }),
      runTransaction: async (fn: (value: typeof tx) => Promise<void>) => fn(tx),
    },
    serverTimestamp: () => 'now',
  };
  const service = new OrdersService(
    firebase as unknown as FirebaseService,
    {} as PricingService,
    {} as ServiceAreaService,
    { get: () => 'https://example.com/track' } as unknown as ConfigService,
  );
  return { service, writes, tx };
}
describe('merchant bid rejection', () => {
  it('rejects an owned active bid and writes its event atomically', async () => {
    const { service, tx } = fixture({
      source: { merchantId: 'shop' },
      status: 'bidding',
    });
    await expect(service.rejectBid(merchant, 'order', 'bid')).resolves.toEqual({
      orderId: 'order',
      bidId: 'bid',
      status: 'rejected',
    });
    expect(tx.set).toHaveBeenCalledTimes(2);
    expect(tx.set.mock.calls[0][1]).toMatchObject({
      status: 'rejected',
      rejectedByMerchantId: 'shop',
    });
  });
  it('denies another merchant without any writes', async () => {
    const { service, writes } = fixture({
      source: { merchantId: 'other' },
      status: 'bidding',
    });
    await expect(
      service.rejectBid(merchant, 'order', 'bid'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toEqual([]);
  });
  it('denies assigned orders and active checkout bids', async () => {
    for (const order of [
      { source: { merchantId: 'shop' }, status: 'bid_accepted' },
      {
        source: { merchantId: 'shop' },
        status: 'bidding',
        payment: { checkoutBidId: 'bid', status: 'checkout_pending' },
      },
    ]) {
      const { service, writes } = fixture(order);
      await expect(
        service.rejectBid(merchant, 'order', 'bid'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(writes).toEqual([]);
    }
  });
  it('is idempotent for an already rejected bid', async () => {
    const { service, writes } = fixture(
      { source: { merchantId: 'shop' }, status: 'bidding' },
      { status: 'rejected' },
    );
    await service.rejectBid(merchant, 'order', 'bid');
    expect(writes).toEqual([]);
  });
});
describe('checkout session ownership', () => {
  const paidIntent = {
    id: 'pi_test',
    status: 'succeeded',
    currency: 'nok',
    amount_received: 10000,
    application_fee_amount: 3900,
    transfer_data: { destination: 'acct_company' },
    metadata: {
      orderId: 'order',
      bidId: 'bid',
      merchantId: 'shop',
      driverId: 'driver',
    },
    latest_charge: {
      id: 'ch_test',
      amount_refunded: 0,
      disputed: false,
      transfer: 'tr_test',
      receipt_url: 'https://pay.stripe.com/receipt',
    },
  };
  it('finalizes a verified owned checkout without reading after transaction writes', async () => {
    const { service, tx } = fixture(
      {
        source: { merchantId: 'shop' },
        status: 'bidding',
        payment: {
          checkoutSessionId: 'session',
          checkoutBidId: 'bid',
          totalOre: 10000,
          platformFeeOre: 3900,
          destinationAccountId: 'acct_company',
          destinationCompanyId: 'company',
        },
      },
      { status: 'active', driver: { id: 'driver' }, offer: { amount: 100 } },
    );
    Object.assign(service, {
      stripe: {
        paymentIntents: { retrieve: async () => paidIntent },
        checkout: {
          sessions: {
            retrieve: async () => ({
              payment_intent: 'pi_test',
              payment_status: 'paid',
              currency: 'nok',
              amount_total: 10000,
              metadata: { merchantId: 'shop', orderId: 'order', bidId: 'bid' },
            }),
          },
        },
      },
    });
    await expect(
      service.finalizeBid(merchant, 'order', 'bid', 'session'),
    ).resolves.toMatchObject({ orderId: 'order' });
    expect(tx.set.mock.calls[0][1]).toMatchObject({
      status: 'bid_accepted',
      paymentStatus: 'paid',
    });
    expect(tx.set.mock.calls[1][1]).toMatchObject({ status: 'accepted' });
  });
  it('rejects succeeded intents with wrong fees, destinations, changed bids or refunds', async () => {
    for (const change of [
      { application_fee_amount: 0 },
      { transfer_data: { destination: 'acct_other' } },
      { metadata: { ...paidIntent.metadata, driverId: 'another' } },
      { latest_charge: { ...paidIntent.latest_charge, amount_refunded: 1000 } },
    ]) {
      const { service, writes } = fixture(
        {
          source: { merchantId: 'shop' },
          status: 'bidding',
          payment: {
            checkoutSessionId: 'session',
            checkoutBidId: 'bid',
            totalOre: 10000,
            platformFeeOre: 3900,
            destinationAccountId: 'acct_company',
          },
        },
        { status: 'active', driver: { id: 'driver' }, offer: { amount: 100 } },
      );
      Object.assign(service, {
        stripe: {
          checkout: {
            sessions: {
              retrieve: async () => ({
                payment_status: 'paid',
                payment_intent: 'pi_test',
                currency: 'nok',
                amount_total: 10000,
                metadata: {
                  merchantId: 'shop',
                  orderId: 'order',
                  bidId: 'bid',
                },
              }),
            },
          },
          paymentIntents: {
            retrieve: async () => ({ ...paidIntent, ...change }),
          },
        },
      });
      await expect(
        service.finalizeBid(merchant, 'order', 'bid', 'session'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(writes).toEqual([]);
    }
  });
  it('rejects a paid session for another merchant/order/bid before writing', async () => {
    const { service, writes } = fixture({});
    Object.assign(service, {
      stripe: {
        checkout: {
          sessions: {
            retrieve: async () => ({
              payment_status: 'paid',
              metadata: { merchantId: 'other', orderId: 'order', bidId: 'bid' },
            }),
          },
        },
      },
    });
    await expect(
      service.finalizeBid(merchant, 'order', 'bid', 'session'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toEqual([]);
  });
  it('rejects a mismatched saved session even with matching metadata', async () => {
    const { service, writes } = fixture({
      source: { merchantId: 'shop' },
      status: 'bidding',
      payment: {
        checkoutSessionId: 'another',
        checkoutBidId: 'bid',
        totalOre: 10000,
      },
    });
    Object.assign(service, {
      stripe: {
        checkout: {
          sessions: {
            retrieve: async () => ({
              payment_status: 'paid',
              currency: 'nok',
              amount_total: 10000,
              metadata: { merchantId: 'shop', orderId: 'order', bidId: 'bid' },
            }),
          },
        },
      },
    });
    await expect(
      service.finalizeBid(merchant, 'order', 'bid', 'session'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(writes).toEqual([]);
  });
});

describe('fixed-price delivery compatibility boundary', () => {
  const fixedOrder = {
    source: { merchantId: 'shop' },
    status: 'available',
    payment: { flow: 'fixed_upfront_v1', status: 'paid' },
  };
  it.each(['list', 'checkout', 'decline', 'finalize'])(
    'rejects legacy %s before writes or Stripe access',
    async (action) => {
      const { service, writes } = fixture(fixedOrder);
      const retrieve = jest.fn();
      Object.assign(service, {
        stripe: { checkout: { sessions: { retrieve } } },
      });
      const result =
        action === 'list'
          ? service.listBids(merchant, 'order')
          : action === 'checkout'
            ? service.createBidCheckout(
                merchant,
                'order',
                'bid',
                'https://example.com',
              )
            : action === 'decline'
              ? service.rejectBid(merchant, 'order', 'bid')
              : service.finalizeBid(merchant, 'order', 'bid', 'session');
      await expect(result).rejects.toBeInstanceOf(ConflictException);
      expect(writes).toEqual([]);
      expect(retrieve).not.toHaveBeenCalled();
    },
  );
});

describe('new fixed-price merchant requests', () => {
  function creationFixture() {
    const writes: Array<{ id: string; data: Record<string, unknown> }> = [];
    const orderRef = {
      id: 'created_order',
      collection: () => ({ doc: () => ({ id: 'order_created' }) }),
    };
    const merchantRef = {
      id: 'shop',
      get: async () => ({
        exists: true,
        ref: merchantRef,
        data: () => ({ status: 'approved', name: 'Shop', shop: {} }),
      }),
    };
    const firebase = {
      db: {
        collection: (path: string) => ({
          doc: (id?: string) =>
            path === 'merchantprofiles'
              ? merchantRef
              : path === 'orders'
                ? orderRef
                : { id },
        }),
        runTransaction: async (fn: (tx: unknown) => Promise<void>) =>
          fn({
            get: async () => ({ data: () => ({ status: 'approved' }) }),
            set: (ref: { id: string }, data: Record<string, unknown>) =>
              writes.push({ id: ref.id, data }),
          }),
      },
      serverTimestamp: () => 'now',
      increment: () => 1,
    };
    const policy = { schemaVersion: 1, revision: 3 };
    const pricing = {
      previewRoute: async () => ({
        pickup: { lat: 59.9, lng: 10.7 },
        dropoff: { lat: 59.91, lng: 10.71 },
        route: { distanceKm: 10, durationMin: 15 },
        pricing: {
          currency: 'NOK',
          total: 270,
          minOffer: 220,
          maxOffer: 810,
          discount: 0,
          pricingRevision: 3,
        },
      }),
      activePolicy: async () => policy,
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
      { get: () => 'https://example.test/track' } as unknown as ConfigService,
    );
    const dto = {
      pickup: { formatted: 'Pickup', city: 'Oslo', countryCode: 'NO' },
      dropoff: { formatted: 'Dropoff', city: 'Oslo', countryCode: 'NO' },
      pickupContact: { name: 'Pickup', phone: '+4791234567' },
      dropoffContact: { name: 'Dropoff', phone: '+4791234567' },
      itemDescription: 'Parcel',
      pickupAuthorizationGranted: true,
    };
    return { service, writes, dto, policy };
  }
  it('creates a hidden posted-price payment request and private PIN atomically', async () => {
    const f = creationFixture();
    const result = await f.service.createOrder(merchant, f.dto);
    expect(result.status).toBe('payment_pending');
    const order = f.writes.find(
      (value) => value.id === 'created_order' && value.data.schemaVersion === 3,
    )?.data;
    expect(order?.payment).toMatchObject({
      flow: 'fixed_upfront_v1',
      choice: 'upfront',
      premium: false,
      status: 'pending',
      totalOre: 27000,
      fundedPolicy: f.policy,
    });
    expect(order?.pricing).toMatchObject({ total: 270, negotiatedTotal: null });
    expect(order?.security).toEqual({ requiresPin: true });
    expect(f.writes.some((value) => value.data.dropoffPin === '1234')).toBe(
      true,
    );
  });
  it('rejects an obsolete manual offer before writing an order', async () => {
    const f = creationFixture();
    await expect(
      f.service.createOrder(merchant, { ...f.dto, amount: 100 }),
    ).rejects.toThrow('prices are fixed');
    expect(f.writes).toHaveLength(0);
  });
  it('requires a fresh quote when the pricing policy changes', async () => {
    const f = creationFixture();
    f.policy.revision = 4;
    await expect(f.service.createOrder(merchant, f.dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(f.writes).toHaveLength(0);
  });
});
