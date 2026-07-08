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

function readPath(obj: unknown, path: string, fallback: unknown = null): string {
  if (!obj || typeof obj !== 'object') return String(fallback ?? '');
  const parts = path.split('.');
  let cursor: unknown = obj;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) {
      return String(fallback ?? '');
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return String(cursor ?? fallback ?? '');
}

function normalizeOrderStatus(value: unknown): string {
  const normalized = (value ?? '').toString().trim().toLowerCase();
  switch (normalized) {
    case 'openforbids':
    case 'bidding':
    case 'pendingbids':
      return 'bidding';
    case 'pending':
    case 'created':
    case 'draft':
    case 'scheduled':
      return normalized;
    default:
      return normalized;
  }
}

function normalizeBidStatus(value: unknown): string {
  return (value ?? 'pending').toString().trim().toLowerCase();
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
        throw new BadRequestException('Stripe is not configured on the API server');
      }
      this.stripe = new Stripe(secret);
    }
    return this.stripe;
  }

  async createOrder(merchant: MerchantContext, dto: CreateOrderDto) {
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

    const merchantData = merchantSnap.data() ?? {};
    const shop = (merchantData.shop as Record<string, unknown>) ?? {};
    const location = (merchantData.location as Record<string, unknown>) ?? {};
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
    const negotiatedTotal =
      dto.amount != null && dto.amount > 0 ? dto.amount : null;
    const finalTotal = negotiatedTotal ?? preview.pricing.total;
    const dropoffPin = this.pricing.generateDropoffPin();
    const orderRef = this.firebase.db.collection(COLLECTIONS.orders).doc();
    const now = this.firebase.serverTimestamp();
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('scheduledAt must be a valid ISO-8601 date');
    }

    const orderDoc = {
      schemaVersion: 2,
      status: scheduledAt ? 'scheduled' : 'bidding',
      createdAt: now,
      updatedAt: now,
      scheduledAt: scheduledAt ?? null,
      creatorType: 'merchant',
      creatorId: merchant.ownerUid,
      merchantId: merchant.merchantId,
      source: {
        type: 'merchant',
        merchantId: merchant.merchantId,
        merchantName: (merchantData.name ?? '').toString(),
        shopDisplayName: (shop.displayName ?? merchant.displayName).toString(),
        createdByUid: merchant.ownerUid,
        channel: 'api',
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
          ...(dto.pickup.postalCode ? { postalCode: dto.pickup.postalCode } : {}),
          ...(dto.pickup.country ? { country: dto.pickup.country } : {}),
          countryCode: dto.pickup.countryCode,
          ...(dto.pickup.placeId ? { placeId: dto.pickup.placeId } : {}),
        },
        contact: {
          name: dto.pickupContact.name,
          phone: dto.pickupContact.phone,
          company: (shop.displayName ?? merchant.displayName).toString(),
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
      security: { dropoffPin },
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

    await orderRef.set(orderDoc);
    await orderRef.collection(COLLECTIONS.events).doc('order_created').set({
      type: 'order_created',
      actor: { type: 'merchant_api', merchantId: merchant.merchantId },
      createdAt: now,
    });

    await merchantSnap.ref.set(
      {
        stats: {
          totalOrders: this.firebase.increment(1),
          updatedAt: now,
        },
        updatedAt: now,
      },
      { merge: true },
    );

    const trackingBaseUrl = this.config.get<string>('merchantTrackingBaseUrl');
    const trackingUrl = this.buildTrackingUrl(
      merchant.merchantId,
      orderRef.id,
      orderRef.id,
      trackingBaseUrl,
    );

    return {
      orderId: orderRef.id,
      status: 'pending',
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
    const order = await this.getMerchantOrderOrThrow(merchant.merchantId, orderId);
    return this.serializeOrder(order.id, order.data);
  }

  async listBids(merchant: MerchantContext, orderId: string) {
    await this.getMerchantOrderOrThrow(merchant.merchantId, orderId);
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
    const orderRef = this.firebase.db.collection(COLLECTIONS.orders).doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      throw new NotFoundException('Order not found');
    }

    const orderData = orderSnap.data() ?? {};
    const orderMerchantId = readPath(orderData, 'source.merchantId', '');
    if (orderMerchantId !== merchant.merchantId) {
      throw new ForbiddenException('Order does not belong to this merchant');
    }

    const status = normalizeOrderStatus(orderData.status);
    if (!OPEN_ORDER_STATUSES.has(status)) {
      throw new ConflictException('Order is no longer open for bids');
    }

    const bidSnap = await orderRef.collection(COLLECTIONS.bids).doc(bidId).get();
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
    const driverData = driverSnap.data() ?? {};
    const companyId = readPath(bidData, 'company.id', driverData.companyId ?? '');

    let destinationAccountId = '';
    if (companyId) {
      const companySnap = await this.firebase.db
        .collection(COLLECTIONS.companyProfiles)
        .doc(companyId)
        .get();
      destinationAccountId = readPath(
        companySnap.data(),
        'stripe.connectAccountId',
        '',
      );
    }
    if (!destinationAccountId) {
      destinationAccountId = (driverData.stripeAccountId ?? '').toString();
    }
    if (!destinationAccountId) {
      throw new ConflictException(
        'Selected driver company has no connected Stripe account',
      );
    }

    const amountNok = Number(readPath(bidData, 'offer.amount', 0));
    const amountOre = Math.round(amountNok * 100);
    if (!Number.isFinite(amountOre) || amountOre <= 0) {
      throw new BadRequestException('Bid amount is invalid');
    }

    const fixedFeeNok = this.config.get<number>('platform.fixedFeeNok', 29);
    const percentFee = this.config.get<number>('platform.percentFee', 0.1);
    const fixedFeeOre = fixedFeeNok * 100;
    const percentFeeOre = Math.round(amountOre * percentFee);
    const platformFeeOre = Math.min(amountOre, fixedFeeOre + percentFeeOre);

    const separator = returnUrl.includes('?') ? '&' : '?';
    const successUrl =
      `${returnUrl}${separator}payment=success&session_id={CHECKOUT_SESSION_ID}` +
      `&orderId=${encodeURIComponent(orderId)}&bidId=${encodeURIComponent(bidId)}`;
    const cancelUrl =
      `${returnUrl}${separator}payment=cancelled&orderId=${encodeURIComponent(orderId)}`;

    const stripe = this.getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
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
        application_fee_amount: platformFeeOre,
        transfer_data: { destination: destinationAccountId },
        metadata: {
          orderId,
          bidId,
          driverId,
          merchantId: merchant.merchantId,
          companyId,
        },
      },
      metadata: {
        orderId,
        bidId,
        driverId,
        merchantId: merchant.merchantId,
        companyId,
      },
    });

    await orderRef.set(
      {
        paymentStatus: 'checkout_pending',
        payment: {
          provider: 'stripe_checkout',
          checkoutSessionId: session.id,
          checkoutBidId: bidId,
          status: 'checkout_pending',
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

  async finalizeBid(
    merchant: MerchantContext,
    orderId: string,
    bidId: string,
    sessionId: string,
  ) {
    const stripe = this.getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      throw new ConflictException('Checkout payment is not completed yet');
    }

    const orderRef = this.firebase.db.collection(COLLECTIONS.orders).doc(orderId);
    const bidRef = orderRef.collection(COLLECTIONS.bids).doc(bidId);

    await this.firebase.db.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) {
        throw new NotFoundException('Order not found');
      }

      const orderData = orderSnap.data() ?? {};
      const orderMerchantId = readPath(orderData, 'source.merchantId', '');
      if (orderMerchantId !== merchant.merchantId) {
        throw new ForbiddenException('Order does not belong to this merchant');
      }

      const paymentStatus = normalizeBidStatus(
        orderData.paymentStatus ?? readPath(orderData, 'payment.status', ''),
      );
      if (paymentStatus !== 'paid') {
        await tx.set(
          orderRef,
          {
            paymentStatus: 'paid',
            payment: {
              ...(orderData.payment as object),
              status: 'paid',
              paidAt: this.firebase.serverTimestamp(),
              checkoutSessionId: sessionId,
            },
            updatedAt: this.firebase.serverTimestamp(),
          },
          { merge: true },
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
      const companyId = readPath(bidData, 'company.id', '');
      const amount = Number(readPath(bidData, 'offer.amount', 0));
      const now = this.firebase.serverTimestamp();

      tx.set(
        orderRef,
        {
          status: 'bid_accepted',
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
    const tracking = (data.tracking as Record<string, unknown>) ?? {};
    const assignment = (data.assignment as Record<string, unknown>) ?? {};
    const driver = (assignment.driver as Record<string, unknown>) ?? {};
    const pricing = (data.pricing as Record<string, unknown>) ?? {};
    const route = (data.route as Record<string, unknown>) ?? {};
    const timeline = (data.timeline as Record<string, unknown>) ?? {};
    const merchantId = readPath(data, 'source.merchantId', '');
    const trackingBaseUrl = this.config.get<string>('merchantTrackingBaseUrl');

    return {
      orderId: id,
      status: data.status,
      schemaVersion: data.schemaVersion ?? 2,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      scheduledAt: data.scheduledAt ?? null,
      creatorType: data.creatorType ?? readPath(data, 'source.type', 'merchant'),
      merchantId,
      source: data.source ?? null,
      tracking: {
        token: (tracking.publicToken ?? id).toString(),
        url: this.buildTrackingUrl(
          merchantId,
          id,
          (tracking.publicToken ?? id).toString(),
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
      paymentStatus: data.paymentStatus ?? readPath(data, 'payment.status', null),
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
