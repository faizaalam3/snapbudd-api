export const COLLECTIONS = {
  orders: 'orders',
  bids: 'bids',
  events: 'events',
  merchantProfiles: 'merchantprofiles',
  merchantUsers: 'merchant_users',
  driverProfiles: 'driverProfiles',
  companyProfiles: 'companyprofiles',
  platformConfig: 'platformConfig',
  serviceAreasDoc: 'serviceAreas',
} as const;

export const OPEN_ORDER_STATUSES = new Set([
  'draft',
  'created',
  'pending',
  'bidding',
  'scheduled',
  'openforbids',
]);

export const ACTIVE_BID_STATUSES = new Set([
  'active',
  'pending',
  'open',
]);

export const APPROVED_MERCHANT_STATUS = 'approved';
