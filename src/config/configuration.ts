export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID ?? 'snapbudd-1',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
  },
  platform: {
    fixedFeeNok: parseInt(process.env.PLATFORM_FIXED_FEE_NOK ?? '29', 10),
    percentFee: parseFloat(process.env.PLATFORM_PERCENT_FEE ?? '0.1'),
  },
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? '',
  apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:3000',
  merchantTrackingBaseUrl:
    process.env.MERCHANT_TRACKING_BASE_URL ??
    'https://snapbudd.io/track',
  corsOrigins: (process.env.CORS_ORIGINS ?? '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
});
