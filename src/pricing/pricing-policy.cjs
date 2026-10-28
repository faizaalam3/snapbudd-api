"use strict";
// Canonical pricing engine. The API's copy is checked for drift by tests.
const DEFAULT_POLICY = {
  schemaVersion: 1,
  revision: 0,
  currency: "NOK",
  bandsKm: [19, 39, 80],
  packages: {
    Small: { bases: [100, 151, 232], perKm: 2.7 },
    Medium: { bases: [211, 271, 362], perKm: 3 },
    Large: { bases: [281, 421, 608], perKm: 3.8 },
    Shopping: { bases: [211, 271, 362], perKm: 3 },
  },
  vehicles: { bike: 0.82, go_mini: 1, go: 1.15, go_plus: 1.45 },
  fees: { fixedNok: 29, deliveryPercent: 10, shopPercent: 20 },
  offers: { roundingNok: 10, minimumMultiplier: 0.8, maximumMultiplier: 3 },
  promotion: {
    enabled: false,
    percent: 0,
    fixedNok: 0,
    startsAt: null,
    endsAt: null,
    orderTypes: ["Small", "Medium", "Large", "Shopping"],
  },
};
const clone = (value) => JSON.parse(JSON.stringify(value));
function validatePolicy(value) {
  if (!value || value.schemaVersion !== 1 || value.currency !== "NOK")
    throw Error("Unsupported pricing schema or currency");
  if (
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    value.revision > 1000000000
  )
    throw Error("Invalid pricing revision");
  const number = (n, min, max, label) => {
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max)
      throw Error(`${label} must be between ${min} and ${max}`);
  };
  if (!Array.isArray(value.bandsKm) || value.bandsKm.length !== 3)
    throw Error("Three distance boundaries are required");
  value.bandsKm.forEach((n, i) => {
    number(n, 0.1, 10000, "Distance boundary");
    if (i && n <= value.bandsKm[i - 1])
      throw Error("Distance boundaries must increase");
  });
  for (const key of Object.keys(DEFAULT_POLICY.packages)) {
    const rule = value.packages?.[key];
    if (!Array.isArray(rule?.bases) || rule.bases.length !== 3)
      throw Error(`${key} requires three base prices`);
    rule.bases.forEach((n) => number(n, 1, 100000, `${key} base`));
    number(rule.perKm, 0, 10000, `${key} price per km`);
  }
  for (const key of Object.keys(DEFAULT_POLICY.vehicles))
    number(value.vehicles?.[key], 0.1, 10, `${key} multiplier`);
  number(value.fees?.fixedNok, 0, 10000, "Fixed app fee");
  number(value.fees?.deliveryPercent, 0, 99, "Delivery commission");
  number(value.fees?.shopPercent, 0, 100, "Shop commission");
  number(value.offers?.roundingNok, 0.01, 100, "Rounding increment");
  number(value.offers?.minimumMultiplier, 0.1, 1, "Minimum offer multiplier");
  number(value.offers?.maximumMultiplier, 1, 10, "Maximum offer multiplier");
  const p = value.promotion;
  if (typeof p?.enabled !== "boolean")
    throw Error("Promotion enabled must be boolean");
  number(p.percent, 0, 100, "Promotion percent");
  number(p.fixedNok, 0, 100000, "Promotion amount");
  if (
    !Array.isArray(p.orderTypes) ||
    !p.orderTypes.length ||
    p.orderTypes.some((key) => !DEFAULT_POLICY.packages[key])
  )
    throw Error("Select supported promotion order types");
  for (const key of ["startsAt", "endsAt"])
    if (
      p[key] !== null &&
      (typeof p[key] !== "string" || !Number.isFinite(Date.parse(p[key])))
    )
      throw Error("Promotion dates must be ISO timestamps or null");
  if (p.startsAt && p.endsAt && Date.parse(p.endsAt) <= Date.parse(p.startsAt))
    throw Error("Promotion end must follow its start");
  // Whitelist fields; never store executable formulas or arbitrary client keys.
  return {
    schemaVersion: 1,
    currency: "NOK",
    revision:
      Number.isSafeInteger(value.revision) && value.revision >= 0
        ? value.revision
        : 0,
    bandsKm: [...value.bandsKm],
    packages: Object.fromEntries(
      Object.keys(DEFAULT_POLICY.packages).map((key) => [
        key,
        {
          bases: [...value.packages[key].bases],
          perKm: value.packages[key].perKm,
        },
      ]),
    ),
    vehicles: Object.fromEntries(
      Object.keys(DEFAULT_POLICY.vehicles).map((key) => [
        key,
        value.vehicles[key],
      ]),
    ),
    fees: {
      fixedNok: value.fees.fixedNok,
      deliveryPercent: value.fees.deliveryPercent,
      shopPercent: value.fees.shopPercent,
    },
    offers: {
      roundingNok: value.offers.roundingNok,
      minimumMultiplier: value.offers.minimumMultiplier,
      maximumMultiplier: value.offers.maximumMultiplier,
    },
    promotion: {
      enabled: p.enabled,
      percent: p.percent,
      fixedNok: p.fixedNok,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      orderTypes: [...new Set(p.orderTypes)],
    },
  };
}
const round2 = (n) => Math.round(n * 100) / 100;
function calculateDelivery(
  input,
  rawPolicy = DEFAULT_POLICY,
  now = Date.now(),
) {
  const policy = validatePolicy(rawPolicy),
    distance = input.distanceKm;
  if (
    typeof distance !== "number" ||
    !Number.isFinite(distance) ||
    distance <= 0 ||
    distance > 10000
  )
    throw Error("A valid driving distance between 0 and 10000 km is required");
  const type = input.orderType || input.packageSize;
  if (typeof type !== "string" || !Object.hasOwn(policy.packages, type))
    throw Error("Unsupported order type");
  const rule = policy.packages[type];
  if (!rule) throw Error("Select Small, Medium, Large or Shopping");
  const vehicle =
    input.vehicleClass ||
    { Car: "go", Van: "go_plus", Bike: "bike" }[input.vehicleType || "Car"];
  const multiplier = Object.hasOwn(policy.vehicles, vehicle)
    ? policy.vehicles[vehicle]
    : null;
  if (!multiplier) throw Error("Select a supported vehicle");
  const band =
    distance <= policy.bandsKm[0] ? 0 : distance <= policy.bandsKm[1] ? 1 : 2;
  const base = round2(
    rule.bases[band] + Math.max(0, distance - policy.bandsKm[2]) * rule.perKm,
  );
  const subtotal = round2(base * multiplier + policy.fees.fixedNok),
    promo = policy.promotion;
  const enabled =
    promo.enabled &&
    promo.orderTypes.includes(type) &&
    (!promo.startsAt || now >= Date.parse(promo.startsAt)) &&
    (!promo.endsAt || now < Date.parse(promo.endsAt));
  // Offers discount the transport component; fees must still be coverable.
  const maximumDiscount = Math.max(0, subtotal - policy.fees.fixedNok - 1);
  const discount = enabled
    ? round2(
        Math.min(
          maximumDiscount,
          (subtotal * promo.percent) / 100 + promo.fixedNok,
        ),
      )
    : 0;
  const increment = policy.offers.roundingNok;
  const rounded = (n) => round2(Math.round(n / increment) * increment);
  const feeFloor = round2(
    (policy.fees.fixedNok + 1) /
      Math.max(0.01, 1 - policy.fees.deliveryPercent / 100),
  );
  const suggestedTotal = Math.max(
    round2(Math.ceil(feeFloor / increment) * increment),
    rounded(subtotal - discount),
  );
  if (!Number.isFinite(suggestedTotal) || suggestedTotal > 100000)
    throw Error("Delivery exceeds the supported payment limit");
  return {
    currency: "NOK",
    base,
    serviceFee: policy.fees.fixedNok,
    vehicleMultiplier: multiplier,
    subtotal,
    discount,
    suggestedTotal,
    total: suggestedTotal,
    negotiatedTotal: null,
    minOffer: Math.min(
      suggestedTotal,
      Math.max(
        feeFloor,
        rounded(suggestedTotal * policy.offers.minimumMultiplier),
      ),
    ),
    maxOffer: Math.min(
      100000,
      round2(suggestedTotal * policy.offers.maximumMultiplier),
    ),
    estimateVersion:
      policy.revision === 0
        ? "customer-bands-v1"
        : `pricing-v1-r${policy.revision}`,
    pricingRevision: policy.revision,
    orderType: type,
    feeRates: { ...policy.fees },
    offerRoundingNok: increment,
  };
}
function deliverySplit(totalOre, companyPercent = 0, policy = DEFAULT_POLICY) {
  if (!Number.isSafeInteger(totalOre) || totalOre <= 0 || totalOre > 1000000000)
    throw Error("Invalid delivery total");
  const fees = validatePolicy(policy).fees;
  if (
    !Number.isFinite(companyPercent) ||
    companyPercent < 0 ||
    companyPercent > 100
  )
    throw Error("Invalid company commission");
  const fixedFeeOre = Math.round(fees.fixedNok * 100),
    platformPercentFeeOre = Math.round((totalOre * fees.deliveryPercent) / 100);
  const platformFeeOre = Math.min(
      totalOre,
      fixedFeeOre + platformPercentFeeOre,
    ),
    distributableOre = totalOre - platformFeeOre;
  const companyEarningOre = Math.round(
    (distributableOre * companyPercent) / 100,
  );
  return {
    fixedFeeOre,
    platformPercentFeeOre,
    platformFeeOre,
    distributableOre,
    companyPercent,
    companyEarningOre,
    driverEarningOre: distributableOre - companyEarningOre,
    pricingRevision: policy.revision,
    feeRates: { ...fees },
  };
}
function shopSplit(totalOre, percent = DEFAULT_POLICY.fees.shopPercent) {
  if (
    !Number.isSafeInteger(totalOre) ||
    totalOre < 0 ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100
  )
    throw Error("Invalid shop total or commission");
  const platformFeeOre = Math.round((totalOre * percent) / 100);
  return { platformFeeOre, storePayoutOre: totalOre - platformFeeOre };
}
async function loadPolicy(db) {
  const snap = await db.collection("pricingConfig").doc("active").get();
  // Missing doc is an explicit migration fallback. Failed reads/corrupt config fail closed.
  return snap.exists ? validatePolicy(snap.data()) : clone(DEFAULT_POLICY);
}
module.exports = {
  DEFAULT_POLICY,
  validatePolicy,
  calculateDelivery,
  deliverySplit,
  shopSplit,
  loadPolicy,
};
