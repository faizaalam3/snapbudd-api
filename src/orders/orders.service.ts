import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { FirebaseService } from '../firebase/firebase.service';
import {
  COLLECTIONS,
  OPEN_ORDER_STATUSES,
  ACTIVE_BID_STATUSES,
} from '../common/constants/firestore.constants';
import { MerchantContext } from '../common/types/merchant-context';
import { PricingService } from '../pricing/pricing.service';
import { ServiceAreaService } from '../service-area/service-area.service';
import { CreateOrderDto } from './dto/orders.dto';
import {
  calculateDeliveryDistribution,
  companyCommissionPercent,
} from '../common/domain/delivery-finance';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

function readPath(
  obj: unknown,
  path: string,
  fallback: unknown = null,
): string {
  if (!obj || typeof obj !== 'object') return asString(fallback);
  const parts = path.split('.');
  let cursor: unknown = obj;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) {
      return asString(fallback);
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return asString(cursor, asString(fallback));
}

function normalizeOrderStatus(value: unknown): string {
  return asString(value).trim().toLowerCase();
}

/** Legacy bidding endpoints cannot mutate an upfront-funded delivery. */
function requireLegacyBidFlow(order: unknown): void {
  if (readPath(order, 'payment.flow', '') === 'fixed_upfront_v1') {
    throw new ConflictException(
      'This is a fixed-price delivery. Use upfront payment and driver job acceptance.',
    );
  }
}

function normalizeBidStatus(value: unknown): string {
  return asString(value, 'pending').trim().toLowerCase();
}

@Injectable()
export class OrdersService {
  private stripe: Stripe | null = null;

  constructor(
    private readonly firebase: FirebaseService,
    private readonly pricing: PricingService,
    private readonly serviceArea: ServiceAreaService,
    private readonly config: ConfigService,
  ) {}

  private getStripe(): Stripe {
    if (!this.stripe) {
      const secret = this.config.get<string>('stripe.secretKey');
      if (!secret) {
        throw new BadRequestException(
          'Stripe is not configured on the API server',
        );
      }
      this.stripe = new Stripe(secret);
    }
    return this.stripe;
  }

  async listOutlets(merchant: MerchantContext) {
    const saved = await this.firebase.db
      .collection(COLLECTIONS.merchantProfiles)
      .doc(merchant.merchantId)
      .collection('outlets')
      .get();
    return saved.docs
      .map((item) => ({ ...item.data(), id: item.id }))
      .sort((a, b) => String(a['name']).localeCompare(String(b['name'])));
  }

  async createOrder(merchant: MerchantContext, dto: CreateOrderDto) {
    let outlet: Record<string, unknown> | undefined;
    let outletRef: FirebaseFirestore.DocumentReference | undefined;
    if (dto.outletId) {
      outletRef = this.firebase.db
        .collection(COLLECTIONS.merchantProfiles)
        .doc(merchant.merchantId)
        .collection('outlets')
        .doc(dto.outletId);
      const saved = await outletRef.get();
      if (!saved.exists || saved.data()?.active !== true) {
        throw new BadRequestException('Selected outlet is unavailable');
      }
      outlet = saved.data()!;
      const lat = Number(outlet.latitude);
      const lng = Number(outlet.longitude);
      if (
        !Number.isFinite(lat) ||
        Math.abs(lat) > 90 ||
        !Number.isFinite(lng) ||
        Math.abs(lng) > 180 ||
        !outlet.address ||
        !outlet.city ||
        !outlet.countryCode
      ) {
        throw new BadRequestException(
          'Outlet location is incomplete. Update it in the portal.',
        );
      }
      // Resolve the pickup from the owned outlet, never from caller coordinates.
      dto = {
        ...dto,
        pickup: {
          formatted: asString(outlet.address),
          city: asString(outlet.city),
          countryCode: asString(outlet.countryCode),
          postalCode: asString(outlet.postalCode),
          lat,
          lng,
        },
        pickupContact: dto.pickupContact || {
          name: asString(outlet.contactName) || asString(outlet.name),
          phone: asString(outlet.contactPhone),
        },
      };
      if (!dto.pickupContact.phone.trim())
        throw new BadRequestException(
          'Outlet pickup phone is missing. Update it in the portal.',
        );
    }
    await this.serviceArea.ensureLoaded();

    const serviceAreaError = this.serviceArea.validateOrderStops({
      pickupCity: dto.pickup.city,
      pickupState: dto.pickup.state,
      pickupCountryCode: dto.pickup.countryCode,
      dropoffCity: dto.dropoff.city,
      dropoffState: dto.dropoff.state,
      dropoffCountryCode: dto.dropoff.countryCode,
    });
    if (serviceAreaError) {
      throw new BadRequestException(serviceAreaError);
    }

    const merchantSnap = await this.firebase.db
      .collection(COLLECTIONS.merchantProfiles)
      .doc(merchant.merchantId)
      .get();
    if (!merchantSnap.exists) {
      throw new NotFoundException('Merchant profile not found');
    }

    const merchantData = asRecord(merchantSnap.data());
    if (merchantData.restaurantMigration) {
      throw new ForbiddenException(
        'This business has moved to its restaurant workspace',
      );
    }
    if (normalizeOrderStatus(merchantData.status) !== 'approved') {
      throw new ForbiddenException(
        'Merchant account must be approved before creating orders',
      );
    }
    const shop = asRecord(merchantData.shop);
    const location = asRecord(merchantData.location);
    const merchantLat = Number(location.latitude ?? 0) || undefined;
    const merchantLng = Number(location.longitude ?? 0) || undefined;

    const preview = await this.pricing.previewRoute({
      pickupAddress: dto.pickup.formatted,
      dropoffAddress: dto.dropoff.formatted,
      packageSize: dto.packageSize ?? 'Medium',
      vehicleType: dto.vehicleType ?? 'Car',
      pickupLat: dto.pickup.lat,
      pickupLng: dto.pickup.lng,
      dropoffLat: dto.dropoff.lat,
      dropoffLng: dto.dropoff.lng,
      merchantLat,
      merchantLng,
    });

    const serviceAreaInfo = this.serviceArea.classifyStops({
      pickupCity: dto.pickup.city,
      pickupState: dto.pickup.state,
      pickupCountryCode: dto.pickup.countryCode,
      dropoffCity: dto.dropoff.city,
      dropoffState: dto.dropoff.state,
      dropoffCountryCode: dto.dropoff.countryCode,
    });

    const customerName = dto.customer?.name?.trim() ?? '';
    const customerPhone = dto.customer?.phone?.trim() ?? '';
    // New requests use the canonical posted price; offers are legacy-only.
    const finalTotal = preview.pricing.total;
    const negotiatedTotal = null;
    if (dto.amount != null && dto.amount !== finalTotal)
      throw new BadRequestException(
        'Delivery prices are fixed. Use the current quoted total.',
      );
    const policy = await this.pricing.activePolicy();
    if (preview.pricing.pricingRevision !== policy.revision)
      throw new ConflictException('Pricing changed. Request a new quote.');
    const dropoffPin = this.pricing.generateDropoffPin();
    const orderRef = this.firebase.db.collection(COLLECTIONS.orders).doc();
    const now = this.firebase.serverTimestamp();
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException(
        'scheduledAt must be a valid ISO-8601 date',
      );
    }

    const orderDoc = {
      id: orderRef.id,
      schemaVersion: 3,
      status: 'payment_pending',
      createdAt: now,
      updatedAt: now,
      scheduledAt: scheduledAt ?? null,
      creatorType: 'merchant',
      creatorId: merchant.ownerUid,
      merchantId: merchant.merchantId,
      source: {
        type: 'merchant',
        merchantId: merchant.merchantId,
        merchantName: asString(merchantData.name),
        shopDisplayName: asString(shop.displayName, merchant.displayName),
        createdByUid: merchant.ownerUid,
        channel: 'api',
        outletId: dto.outletId || null,
        outletName: outlet?.name || null,
      },
      customer: {
        id: '',
        name: customerName,
        phone: customerPhone,
      },
      pickup: {
        location: preview.pickup,
        address: {
          formatted: dto.pickup.formatted,
          ...(dto.pickup.street ? { street: dto.pickup.street } : {}),
          city: dto.pickup.city,
          ...(dto.pickup.state ? { state: dto.pickup.state } : {}),
          ...(dto.pickup.postalCode
            ? { postalCode: dto.pickup.postalCode }
            : {}),
          ...(dto.pickup.country ? { country: dto.pickup.country } : {}),
          countryCode: dto.pickup.countryCode,
          ...(dto.pickup.placeId ? { placeId: dto.pickup.placeId } : {}),
        },
        contact: {
          name: dto.pickupContact.name,
          phone: dto.pickupContact.phone,
          company: asString(shop.displayName, merchant.displayName),
        },
      },
      dropoff: {
        location: preview.dropoff,
        address: {
          formatted: dto.dropoff.formatted,
          ...(dto.dropoff.street ? { street: dto.dropoff.street } : {}),
          city: dto.dropoff.city,
          ...(dto.dropoff.state ? { state: dto.dropoff.state } : {}),
          ...(dto.dropoff.postalCode
            ? { postalCode: dto.dropoff.postalCode }
            : {}),
          ...(dto.dropoff.country ? { country: dto.dropoff.country } : {}),
          countryCode: dto.dropoff.countryCode,
          ...(dto.dropoff.placeId ? { placeId: dto.dropoff.placeId } : {}),
        },
        contact: {
          name: dto.dropoffContact.name,
          phone: dto.dropoffContact.phone,
        },
      },
      shipment: {
        size: dto.packageSize ?? 'Medium',
        type: dto.packageType ?? 'General',
        description: dto.itemDescription,
        notes: dto.notes ?? '',
        receipt: { url: dto.receiptUrl, uploadedAt: now },
        vehicleType: dto.vehicleType ?? 'Car',
        options: {
          fragile: dto.fragile ?? false,
          requiresSignature: dto.requiresSignature ?? false,
          contactless: dto.contactless ?? false,
        },
      },
      route: preview.route,
      assignment: { driverId: null, companyId: null },
      security: { requiresPin: true },
      pickupAuthorization: {
        granted: dto.pickupAuthorizationGranted === true,
        customerName: dto.customer?.name ?? dto.dropoffContact.name,
        grantedByMerchantId: merchant.merchantId,
        grantedAt: now,
        consentVersion: 'pickup-v1',
      },
      ratings: { customerToDriver: {}, driverToCustomer: {} },
      timeline: {
        merchantPlacedAt: now,
        acceptedAt: null,
        startedAt: null,
        pickedUpAt: null,
        deliveredAt: null,
        cancelledAt: null,
        cancelledBy: null,
      },
      notes: dto.notes ?? '',
      returnToShop: dto.returnToShop ?? false,
      schedule: {
        isScheduled: scheduledAt != null,
        scheduledAt: scheduledAt ?? null,
        fulfillmentType: scheduledAt ? 'scheduled' : 'asap',
      },
      scheduling: {
        fulfillmentType: scheduledAt ? 'scheduled' : 'asap',
        scheduledAt: scheduledAt ?? null,
      },
      flags: {
        isPublic: true,
        requiresPin: true,
        hasDispute: false,
        isArchived: false,
      },
      payment: {
        provider: 'stripe',
        flow: 'fixed_upfront_v1',
        choice: 'upfront',
        premium: false,
        currency: 'NOK',
        totalOre: Math.round(finalTotal * 100),
        generation: 1,
        fundedPolicy: policy,
        status: 'pending',
      },
      pricing: {
        ...preview.pricing,
        discount: { promoCode: null, amount: preview.pricing.discount },
        total: finalTotal,
        negotiatedTotal,
      },
      tracking: {
        publicToken: orderRef.id,
        publicTrackingEnabled: true,
      },
      serviceArea: serviceAreaInfo,
    };

    const secretRef = this.firebase.db
      .collection(COLLECTIONS.orderSecrets)
      .doc(orderRef.id);
    await this.firebase.db.runTransaction(async (tx) => {
      const currentMerchant = await tx.get(merchantSnap.ref);
      if (currentMerchant.data()?.status !== 'approved')
        throw new ForbiddenException('Merchant account is no longer approved');
      if (currentMerchant.data()?.restaurantMigration)
        throw new ForbiddenException(
          'This business has moved to its restaurant workspace',
        );
      if (outletRef && outlet) {
        const current = (await tx.get(outletRef)).data();
        if (!current || current.active !== true)
          throw new ConflictException(
            'Outlet became unavailable. Choose another pickup.',
          );
        if (
          [
            'name',
            'address',
            'city',
            'countryCode',
            'latitude',
            'longitude',
            'contactName',
            'contactPhone',
          ].some((key) => current[key] !== outlet[key])
        ) {
          throw new ConflictException(
            'Outlet changed while preparing the order. Refresh its pickup details and try again.',
          );
        }
      }
      // Order, PIN, event and merchant count commit together. A failed auxiliary
      // write must not leave a created order that the caller might retry.
      tx.set(orderRef, orderDoc);
      tx.set(secretRef, {
        orderId: orderRef.id,
        customerId: '',
        merchantId: merchant.merchantId,
        dropoffPin,
        createdByUid: merchant.ownerUid,
        createdAt: now,
        verifiedAt: null,
      });
      tx.set(orderRef.collection(COLLECTIONS.events).doc('order_created'), {
        type: 'order_created',
        actor: { type: 'merchant_api', merchantId: merchant.merchantId },
        createdAt: now,
      });
      tx.set(
        merchantSnap.ref,
        {
          stats: {
            totalOrders: this.firebase.increment(1),
            updatedAt: now,
          },
          updatedAt: now,
        },
        { merge: true },
      );
    });

    const trackingBaseUrl = this.config.get<string>('merchantTrackingBaseUrl');
    const trackingUrl = this.buildTrackingUrl(
      merchant.merchantId,
      orderRef.id,
      orderRef.id,
      trackingBaseUrl,
    );

    return {
      orderId: orderRef.id,
      status: orderDoc.status,
      trackingToken: orderRef.id,
      trackingUrl,
      pricing: {
        currency: preview.pricing.currency,
        total: finalTotal,
        distanceKm: preview.route.distanceKm,
        durationMin: preview.route.durationMin,
      },
    };
  }

  async getOrder(merchant: MerchantContext, orderId: string) {
    const order = await this.getMerchantOrderOrThrow(
      merchant.merchantId,
      orderId,
    );
    return this.serializeOrder(order.id, order.data);
  }

  async listBids(merchant: MerchantContext, orderId: string) {
    const order = await this.getMerchantOrderOrThrow(
      merchant.merchantId,
      orderId,
    );
    requireLegacyBidFlow(order.data);
    const bidsSnap = await this.firebase.db
      .collection(COLLECTIONS.orders)
      .doc(orderId)
      .collection(COLLECTIONS.bids)
      .orderBy('createdAt', 'asc')
      .get();

    return bidsSnap.docs.map((doc) => this.serializeBid(doc.id, doc.data()));
  }

  async createBidCheckout(
    merchant: MerchantContext,
    orderId: string,
    bidId: string,
    returnUrl: string,
  ) {
    const order = (
      await this.firebase.db.collection(COLLECTIONS.orders).doc(orderId).get()
    ).data();
    if (readPath(order || {}, 'source.merchantId', '') !== merchant.merchantId)
      throw new ForbiddenException('Order does not belong to this merchant');
    requireLegacyBidFlow(order);
    const lockRef = this.firebase.db.collection('checkoutLocks').doc(orderId),
      token = randomUUID();
    await this.firebase.db.runTransaction(async (tx) => {
      const lock = (await tx.get(lockRef)).data();
      if (lock && Number(lock.expiresAt) > Date.now())
        throw new ConflictException(
          'Checkout is being updated. Retry in a moment.',
        );
      tx.set(lockRef, { token, expiresAt: Date.now() + 120000 });
    });
    try {
      return await this.createBidCheckoutUnlocked(
        merchant,
        orderId,
        bidId,
        returnUrl,
      );
    } finally {
      await this.firebase.db
        .runTransaction(async (tx) => {
          if ((await tx.get(lockRef)).data()?.token === token)
            tx.delete(lockRef);
        })
        .catch(() => {});
    }
  }
  private async createBidCheckoutUnlocked(
    merchant: MerchantContext,
    orderId: string,
    bidId: string,
    returnUrl: string,
  ) {
    const orderRef = this.firebase.db
      .collection(COLLECTIONS.orders)
      .doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      throw new NotFoundException('Order not found');
    }

    const orderData = orderSnap.data() ?? {};
    requireLegacyBidFlow(orderData);
    const orderMerchantId = readPath(orderData, 'source.merchantId', '');
    if (orderMerchantId !== merchant.merchantId) {
      throw new ForbiddenException('Order does not belong to this merchant');
    }

    const savedCheckout = readPath(orderData, 'payment.checkoutSessionId', '');
    if (savedCheckout) {
      const previous =
        await this.getStripe().checkout.sessions.retrieve(savedCheckout);
      if (previous.payment_status === 'paid')
        throw new ConflictException('This order is already paid');
      if (previous.status === 'open') {
        if (readPath(orderData, 'payment.checkoutBidId', '') !== bidId)
          throw new ConflictException(
            'Another bid already has a checkout in progress',
          );
        return {
          checkoutUrl: previous.url,
          sessionId: previous.id,
          orderId,
          bidId,
        };
      }
    }

    const status = normalizeOrderStatus(orderData.status);
    if (!OPEN_ORDER_STATUSES.has(status)) {
      throw new ConflictException('Order is no longer open for bids');
    }

    const bidSnap = await orderRef
      .collection(COLLECTIONS.bids)
      .doc(bidId)
      .get();
    if (!bidSnap.exists) {
      throw new NotFoundException('Bid not found');
    }

    const bidData = bidSnap.data() ?? {};
    if (!ACTIVE_BID_STATUSES.has(normalizeBidStatus(bidData.status))) {
      throw new ConflictException('Bid is no longer active');
    }

    const driverId = readPath(bidData, 'driver.id', bidId);
    const driverSnap = await this.firebase.db
      .collection(COLLECTIONS.driverProfiles)
      .doc(driverId)
      .get();
    const driverData = asRecord(driverSnap.data());
    const companyId = readPath(
      bidData,
      'company.id',
      driverData.companyId ?? '',
    );

    let destinationAccountId = '';
    let companyData: Record<string, unknown> = {};
    if (companyId) {
      const companySnap = await this.firebase.db
        .collection(COLLECTIONS.companyProfiles)
        .doc(companyId)
        .get();
      companyData = companySnap.data() ?? {};
      destinationAccountId = readPath(
        companyData,
        'stripe.connectAccountId',
        '',
      );
    }
    if (!destinationAccountId && !companyId) {
      destinationAccountId = asString(driverData.stripeAccountId);
    }
    if (!destinationAccountId) {
      throw new ConflictException(
        'Selected driver company has no connected Stripe account',
      );
    }

    const amountNok = Number(readPath(bidData, 'offer.amount', 0));
    const amountOre = Math.round(amountNok * 100);
    if (
      !Number.isSafeInteger(amountOre) ||
      amountOre <= 0 ||
      amountOre > 10000000
    ) {
      throw new BadRequestException('Bid amount is invalid');
    }

    const policy = await this.pricing.activePolicy();
    const fixedFeeNok = policy.fees.fixedNok;
    const percentFee = policy.fees.deliveryPercent / 100;
    const split = calculateDeliveryDistribution({
      totalOre: amountOre,
      platformFixedFeeOre: fixedFeeNok * 100,
      platformPercent: percentFee,
      companyCommissionPercent: companyId
        ? companyCommissionPercent(companyData)
        : 0,
    });

    const separator = returnUrl.includes('?') ? '&' : '?';
    const successUrl =
      `${returnUrl}${separator}payment=success&session_id={CHECKOUT_SESSION_ID}` +
      `&orderId=${encodeURIComponent(orderId)}&bidId=${encodeURIComponent(bidId)}`;
    const cancelUrl = `${returnUrl}${separator}payment=cancelled&orderId=${encodeURIComponent(orderId)}`;

    const stripe = this.getStripe();
    if (split.distributableOre <= 0)
      throw new ConflictException('Bid amount is too low for delivery fees');
    const account = await stripe.accounts.retrieve(destinationAccountId);
    if (!account.charges_enabled || !account.payouts_enabled)
      throw new ConflictException('Company Stripe verification is incomplete');
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'nok',
              unit_amount: amountOre,
              product_data: {
                name: `SnapBudd delivery ${orderId.slice(0, 8).toUpperCase()}`,
                description: `Driver bid from ${readPath(bidData, 'driver.name', 'Driver')}`,
              },
            },
          },
        ],
        payment_intent_data: {
          application_fee_amount: split.platformFeeOre,
          transfer_data: { destination: destinationAccountId },
          metadata: {
            orderId,
            bidId,
            driverId,
            merchantId: merchant.merchantId,
            companyId,
            platformFeeOre: String(split.platformFeeOre),
            distributableOre: String(split.distributableOre),
            companyCommissionPercent: String(split.companyCommissionPercent),
            companyEarningOre: String(split.companyEarningOre),
            driverEarningOre: String(split.driverEarningOre),
          },
        },
        metadata: {
          orderId,
          bidId,
          driverId,
          merchantId: merchant.merchantId,
          companyId,
          companyCommissionPercent: String(split.companyCommissionPercent),
        },
      },
      {
        idempotencyKey: `merchant-delivery:${orderId}:${bidId}:${savedCheckout || 'initial'}:r${policy.revision}:c${split.companyCommissionPercent}`,
      },
    );

    await orderRef.set(
      {
        paymentStatus: 'checkout_pending',
        payment: {
          provider: 'stripe_checkout',
          checkoutSessionId: session.id,
          checkoutBidId: bidId,
          status: 'checkout_pending',
          totalOre: split.totalOre,
          destinationAccountId,
          destinationCompanyId: companyId || null,
          pricingRevision: policy.revision,
          feeRates: policy.fees,
          platformFeeOre: split.platformFeeOre,
          destinationNetOre: split.distributableOre,
          companyCommissionPercent: split.companyCommissionPercent,
          companyEarningOre: split.companyEarningOre,
          driverEarningOre: split.driverEarningOre,
        },
        pricing: {
          amount: amountNok,
          total: amountNok,
          platformFee: split.platformFeeOre / 100,
          companyNet: split.distributableOre / 100,
          companyCommissionPercent: split.companyCommissionPercent,
          companyEarning: split.companyEarningOre / 100,
          driverEarning: split.driverEarningOre / 100,
        },
        updatedAt: this.firebase.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
      orderId,
      bidId,
    };
  }

  async rejectBid(merchant: MerchantContext, orderId: string, bidId: string) {
    const orderRef = this.firebase.db
      .collection(COLLECTIONS.orders)
      .doc(orderId);
    const bidRef = orderRef.collection(COLLECTIONS.bids).doc(bidId);
    await this.firebase.db.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new NotFoundException('Order not found');
      const order = orderSnap.data() ?? {};
      requireLegacyBidFlow(order);
      if (readPath(order, 'source.merchantId', '') !== merchant.merchantId) {
        throw new ForbiddenException('Order does not belong to this merchant');
      }
      if (!OPEN_ORDER_STATUSES.has(normalizeOrderStatus(order.status))) {
        throw new ConflictException('Order is no longer open for bids');
      }
      if (
        readPath(order, 'payment.checkoutBidId', '') === bidId &&
        ['checkout_pending', 'paid'].includes(
          readPath(order, 'payment.status', ''),
        )
      ) {
        throw new ConflictException(
          'This bid has an active checkout; resolve payment before rejecting it',
        );
      }
      const bidSnap = await tx.get(bidRef);
      if (!bidSnap.exists) throw new NotFoundException('Bid not found');
      const bid = bidSnap.data() ?? {};
      if (normalizeBidStatus(bid.status) === 'rejected') return;
      if (!ACTIVE_BID_STATUSES.has(normalizeBidStatus(bid.status))) {
        throw new ConflictException('Bid is no longer active');
      }
      const now = this.firebase.serverTimestamp();
      tx.set(
        bidRef,
        {
          status: 'rejected',
          rejectedAt: now,
          updatedAt: now,
          rejectedByMerchantId: merchant.merchantId,
        },
        { merge: true },
      );
      tx.set(orderRef.collection('events').doc(), {
        type: 'bid_rejected',
        orderId,
        bidId,
        actorRole: 'merchant',
        actorId: merchant.merchantId,
        createdAt: now,
      });
    });
    return { orderId, bidId, status: 'rejected' };
  }

  async finalizeBid(
    merchant: MerchantContext,
    orderId: string,
    bidId: string,
    sessionId: string,
  ) {
    const ownedOrder = await this.getMerchantOrderOrThrow(
      merchant.merchantId,
      orderId,
    );
    requireLegacyBidFlow(ownedOrder.data);
    const stripe = this.getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      throw new ConflictException('Checkout payment is not completed yet');
    }
    if (
      session.metadata?.merchantId !== merchant.merchantId ||
      session.metadata?.orderId !== orderId ||
      session.metadata?.bidId !== bidId
    ) {
      throw new ForbiddenException(
        'Checkout session does not belong to this order and bid',
      );
    }

    const intentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!intentId)
      throw new ConflictException('Checkout has no Stripe payment');
    const intent = await stripe.paymentIntents.retrieve(intentId, {
      expand: ['latest_charge.transfer'],
    });
    const charge =
      typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
    if (
      intent.status !== 'succeeded' ||
      intent.currency !== 'nok' ||
      !charge ||
      charge.disputed ||
      charge.amount_refunded > 0
    )
      throw new ConflictException(
        'Payment requires verification or refund/dispute review',
      );
    const transfer = charge.transfer;
    const transferId =
      typeof transfer === 'string' ? transfer : transfer?.id || null;
    const orderRef = this.firebase.db
      .collection(COLLECTIONS.orders)
      .doc(orderId);
    const bidRef = orderRef.collection(COLLECTIONS.bids).doc(bidId);

    await this.firebase.db.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) {
        throw new NotFoundException('Order not found');
      }

      const orderData = orderSnap.data() ?? {};
      requireLegacyBidFlow(orderData);
      const orderMerchantId = readPath(orderData, 'source.merchantId', '');
      if (orderMerchantId !== merchant.merchantId) {
        throw new ForbiddenException('Order does not belong to this merchant');
      }
      if (
        readPath(orderData, 'payment.checkoutSessionId', '') !== sessionId ||
        readPath(orderData, 'payment.checkoutBidId', '') !== bidId ||
        intent.amount_received !==
          Number(readPath(orderData, 'payment.totalOre', 0)) ||
        intent.application_fee_amount !==
          Number(readPath(orderData, 'payment.platformFeeOre', -1)) ||
        (typeof intent.transfer_data?.destination === 'string'
          ? intent.transfer_data.destination
          : intent.transfer_data?.destination?.id) !==
          readPath(orderData, 'payment.destinationAccountId', '') ||
        intent.metadata?.orderId !== orderId ||
        intent.metadata?.bidId !== bidId ||
        intent.metadata?.merchantId !== merchant.merchantId ||
        session.currency !== 'nok' ||
        session.amount_total !==
          Number(readPath(orderData, 'payment.totalOre', '0'))
      ) {
        throw new ConflictException(
          'Checkout session does not match the saved payment',
        );
      }

      const currentStatus = normalizeOrderStatus(orderData.status);
      if (!OPEN_ORDER_STATUSES.has(currentStatus)) {
        return;
      }

      const assignmentDriverId = readPath(orderData, 'assignment.driverId', '');
      if (assignmentDriverId) {
        throw new ConflictException('A driver is already assigned');
      }

      const bidSnap = await tx.get(bidRef);
      if (!bidSnap.exists) {
        throw new NotFoundException('Bid not found');
      }

      const bidData = bidSnap.data() ?? {};
      if (!ACTIVE_BID_STATUSES.has(normalizeBidStatus(bidData.status))) {
        throw new ConflictException('Bid is no longer active');
      }

      const driverId = readPath(bidData, 'driver.id', bidId);
      const companyId = readPath(orderData, 'payment.destinationCompanyId', '');
      const amount = Number(readPath(bidData, 'offer.amount', 0));
      if (
        Math.round(amount * 100) !== intent.amount_received ||
        driverId !== intent.metadata?.driverId
      )
        throw new ConflictException('Paid bid details have changed');
      const now = this.firebase.serverTimestamp();

      tx.set(
        orderRef,
        {
          status: 'bid_accepted',
          paymentStatus: 'paid',
          payment: {
            ...(orderData.payment as object),
            status: 'paid',
            paidAt: now,
            checkoutSessionId: sessionId,
            paymentIntentId: intent.id,
            verifiedAt: now,
            stripeChargeId: charge.id,
            stripeTransferId: transferId,
            transferStatus: transferId ? 'transferred' : 'pending',
            receipt: {
              ...asRecord(asRecord(orderData.payment).receipt),
              url: charge.receipt_url,
              number: charge.receipt_number,
              chargeId: charge.id,
              provider: 'stripe',
            },
          },
          assignment: {
            acceptedBidId: bidId,
            driverId,
            driver: {
              id: driverId,
              name: readPath(bidData, 'driver.name', `Driver ${driverId}`),
              phone: readPath(bidData, 'driver.phone', ''),
              ratingAvg: readPath(bidData, 'driver.ratingAvg', null),
            },
            vehicle: readPath(bidData, 'vehicle', {}),
            companyId: companyId || null,
          },
          pricing: {
            ...(orderData.pricing as object),
            total: amount,
          },
          timeline: {
            ...(orderData.timeline as object),
            acceptedAt: now,
          },
          updatedAt: now,
        },
        { merge: true },
      );

      tx.set(
        bidRef,
        {
          status: 'accepted',
          acceptedAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
    });

    const bidsSnap = await orderRef.collection(COLLECTIONS.bids).get();
    const batch = this.firebase.db.batch();
    for (const doc of bidsSnap.docs) {
      if (doc.id === bidId) continue;
      const status = normalizeBidStatus(doc.data().status);
      if (ACTIVE_BID_STATUSES.has(status)) {
        batch.set(
          doc.ref,
          { status: 'rejected', updatedAt: this.firebase.serverTimestamp() },
          { merge: true },
        );
      }
    }
    await batch.commit();

    await orderRef.collection(COLLECTIONS.events).add({
      type: 'bid_accepted',
      bidId,
      actor: { type: 'merchant_api', merchantId: merchant.merchantId },
      createdAt: this.firebase.serverTimestamp(),
    });

    return this.getOrder(merchant, orderId);
  }

  private async getMerchantOrderOrThrow(merchantId: string, orderId: string) {
    const snap = await this.firebase.db
      .collection(COLLECTIONS.orders)
      .doc(orderId)
      .get();
    if (!snap.exists) {
      throw new NotFoundException('Order not found');
    }
    const data = snap.data() ?? {};
    const orderMerchantId = readPath(data, 'source.merchantId', '');
    if (orderMerchantId !== merchantId) {
      throw new ForbiddenException('Order does not belong to this merchant');
    }
    return { id: snap.id, data };
  }

  private serializeOrder(id: string, data: Record<string, unknown>) {
    const tracking = asRecord(data.tracking);
    const assignment = asRecord(data.assignment);
    const driver = asRecord(assignment.driver);
    const pricing = asRecord(data.pricing);
    const route = asRecord(data.route);
    const timeline = asRecord(data.timeline);
    const merchantId = readPath(data, 'source.merchantId', '');
    const trackingBaseUrl = this.config.get<string>('merchantTrackingBaseUrl');

    return {
      orderId: id,
      status: data.status,
      schemaVersion: data.schemaVersion ?? 2,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      scheduledAt: data.scheduledAt ?? null,
      creatorType:
        data.creatorType ?? readPath(data, 'source.type', 'merchant'),
      merchantId,
      source: data.source ?? null,
      tracking: {
        token: asString(tracking.publicToken, id),
        url: this.buildTrackingUrl(
          merchantId,
          id,
          asString(tracking.publicToken, id),
          trackingBaseUrl,
        ),
        enabled: tracking.publicTrackingEnabled !== false,
      },
      customer: data.customer ?? null,
      pickup: data.pickup ?? null,
      dropoff: data.dropoff ?? null,
      shipment: data.shipment ?? null,
      route,
      security: data.security ?? null,
      pickupAuthorization: data.pickupAuthorization ?? null,
      ratings: data.ratings ?? null,
      schedule: data.schedule ?? null,
      scheduling: data.scheduling ?? null,
      serviceArea: data.serviceArea ?? null,
      flags: data.flags ?? null,
      pricing: data.pricing ?? {
        currency: pricing.currency ?? 'NOK',
        total: pricing.total ?? null,
        negotiatedTotal: pricing.negotiatedTotal ?? null,
      },
      assignment: {
        driverId: assignment.driverId ?? null,
        driverName: driver.name ?? null,
        driverPhone: driver.phone ?? null,
        companyId: assignment.companyId ?? null,
        acceptedBidId: assignment.acceptedBidId ?? null,
        driver: assignment.driver ?? driver,
        vehicle: assignment.vehicle ?? null,
      },
      timeline,
      payment: data.payment ?? { status: data.paymentStatus ?? null },
      paymentStatus:
        data.paymentStatus ?? readPath(data, 'payment.status', null),
    };
  }

  private serializeBid(id: string, data: Record<string, unknown>) {
    const offer = (data.offer as Record<string, unknown>) ?? {};
    const driver = (data.driver as Record<string, unknown>) ?? {};
    const vehicle = (data.vehicle as Record<string, unknown>) ?? {};
    return {
      bidId: id,
      status: data.status,
      createdAt: data.createdAt,
      offer: {
        amount: offer.amount ?? null,
        currency: offer.currency ?? 'NOK',
        etaMin: offer.etaMin ?? null,
        note: offer.note ?? null,
      },
      driver: {
        id: driver.id ?? id,
        name: driver.name ?? null,
        phone: driver.phone ?? null,
        ratingAvg: driver.ratingAvg ?? null,
        ratingCount: driver.ratingCount ?? null,
      },
      vehicle,
    };
  }

  private buildTrackingUrl(
    merchantId: string,
    orderId: string,
    token: string,
    baseUrl?: string,
  ): string {
    const base = (baseUrl ?? 'https://snapbudd.io/merchant/track').trim();
    const uri = new URL(base);
    uri.searchParams.set('merchantId', merchantId);
    uri.searchParams.set('orderId', orderId);
    uri.searchParams.set('token', token);
    return uri.toString();
  }
}
