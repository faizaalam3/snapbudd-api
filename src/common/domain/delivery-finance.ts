export interface DeliveryDistribution {
  totalOre: number;
  platformFixedFeeOre: number;
  platformPercentFeeOre: number;
  platformFeeOre: number;
  distributableOre: number;
  companyCommissionPercent: number;
  companyEarningOre: number;
  driverEarningOre: number;
}

export function clampPercent(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, parsed));
}

export function companyCommissionPercent(
  company: Record<string, unknown>,
): number {
  const policy = (company.driverPayoutPolicy ?? {}) as Record<string, unknown>;
  return clampPercent(
    policy.companyPercent ??
      company.driverCommissionPercent ??
      company.commissionPercentage,
    0,
  );
}

export function calculateDeliveryDistribution(input: {
  totalOre: number;
  platformFixedFeeOre: number;
  platformPercent: number;
  companyCommissionPercent: number;
}): DeliveryDistribution {
  const totalOre = Math.max(0, Math.round(input.totalOre));
  const platformFixedFeeOre = Math.max(
    0,
    Math.round(input.platformFixedFeeOre),
  );
  const platformPercentFeeOre = Math.max(
    0,
    Math.round((totalOre * clampPercent(input.platformPercent * 100)) / 100),
  );
  const platformFeeOre = Math.min(
    totalOre,
    platformFixedFeeOre + platformPercentFeeOre,
  );
  const distributableOre = totalOre - platformFeeOre;
  const companyPercent = clampPercent(input.companyCommissionPercent);
  const companyEarningOre = Math.round(
    (distributableOre * companyPercent) / 100,
  );
  const driverEarningOre = distributableOre - companyEarningOre;

  return {
    totalOre,
    platformFixedFeeOre,
    platformPercentFeeOre,
    platformFeeOre,
    distributableOre,
    companyCommissionPercent: companyPercent,
    companyEarningOre,
    driverEarningOre,
  };
}
