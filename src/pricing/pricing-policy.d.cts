import type { Firestore } from 'firebase-admin/firestore';
export interface PricingPolicy {
  schemaVersion: 1;
  revision: number;
  currency: 'NOK';
  bandsKm: number[];
  packages: Record<string, { bases: number[]; perKm: number }>;
  vehicles: Record<string, number>;
  fees: { fixedNok: number; deliveryPercent: number; shopPercent: number };
  offers: {
    roundingNok: number;
    minimumMultiplier: number;
    maximumMultiplier: number;
  };
  promotion: {
    enabled: boolean;
    percent: number;
    fixedNok: number;
    startsAt: string | null;
    endsAt: string | null;
    orderTypes: string[];
  };
}
export interface PricingResult {
  currency: 'NOK';
  base: number;
  serviceFee: number;
  vehicleMultiplier: number;
  subtotal: number;
  discount: number;
  suggestedTotal: number;
  total: number;
  negotiatedTotal: null;
  minOffer: number;
  maxOffer: number;
  estimateVersion: string;
  pricingRevision: number;
  orderType: string;
  feeRates: PricingPolicy['fees'];
  offerRoundingNok: number;
}
export const DEFAULT_POLICY: PricingPolicy;
export function validatePolicy(value: unknown): PricingPolicy;
export function loadPolicy(db: Firestore): Promise<PricingPolicy>;
export function calculateDelivery(
  input: {
    distanceKm: number;
    packageSize?: string;
    orderType?: string;
    vehicleType?: string;
    vehicleClass?: string;
  },
  policy?: PricingPolicy,
  now?: number,
): PricingResult;
export function deliverySplit(
  totalOre: number,
  companyPercent?: number,
  policy?: PricingPolicy,
): {
  fixedFeeOre: number;
  platformPercentFeeOre: number;
  platformFeeOre: number;
  distributableOre: number;
  companyPercent: number;
  companyEarningOre: number;
  driverEarningOre: number;
  pricingRevision: number;
  feeRates: PricingPolicy['fees'];
};
export function shopSplit(
  totalOre: number,
  percent?: number,
): { platformFeeOre: number; storePayoutOre: number };
