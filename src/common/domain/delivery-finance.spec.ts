import {
  calculateDeliveryDistribution,
  companyCommissionPercent,
} from './delivery-finance';

describe('delivery finance', () => {
  it('reconciles platform, company and driver amounts exactly', () => {
    const split = calculateDeliveryDistribution({
      totalOre: 10_000,
      platformFixedFeeOre: 2_900,
      platformPercent: 0.1,
      companyCommissionPercent: 20,
    });

    expect(split.platformFeeOre).toBe(3_900);
    expect(split.companyEarningOre).toBe(1_220);
    expect(split.driverEarningOre).toBe(4_880);
    expect(
      split.platformFeeOre + split.companyEarningOre + split.driverEarningOre,
    ).toBe(split.totalOre);
  });

  it('caps fees at the order total and never produces negative earnings', () => {
    const split = calculateDeliveryDistribution({
      totalOre: 1_000,
      platformFixedFeeOre: 2_900,
      platformPercent: 0.1,
      companyCommissionPercent: 25,
    });
    expect(split.platformFeeOre).toBe(1_000);
    expect(split.companyEarningOre).toBe(0);
    expect(split.driverEarningOre).toBe(0);
  });

  it('reads the canonical payout policy and safely clamps legacy values', () => {
    expect(
      companyCommissionPercent({
        driverPayoutPolicy: { companyPercent: 12.5 },
      }),
    ).toBe(12.5);
    expect(companyCommissionPercent({ driverCommissionPercent: 140 })).toBe(
      100,
    );
    expect(companyCommissionPercent({})).toBe(0);
  });
});
