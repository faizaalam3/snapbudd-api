# SnapBudd API — Deployment Guide

## Overview

Deploy `snapbudd-api` as a standalone Node.js service. It connects to the existing Firebase project `snapbudd-1` and uses the same Firestore data as the SnapBudd apps.

No changes are required to `Snapbudd`, `snapbudd_admin`, or `snapbudd_company`.

## Prerequisites

| Item | Where to get it |
|------|-----------------|
| Firebase service account JSON | Firebase Console → `snapbudd-1` → Project Settings → Service Accounts |
| Stripe secret key | Same key used in Snapbudd Cloud Functions (`functions.config().stripe.secret`) |
| Google Maps API key | Same key used by merchant portal (geocoding) |
| Domain / hosting | Cloud Run, Railway, Render, Fly.io, or your VPS |

## Environment variables

Copy `.env.example` to `.env` (or set in your hosting dashboard):

```bash
PORT=3000
NODE_ENV=production
FIREBASE_PROJECT_ID=snapbudd-1
GOOGLE_APPLICATION_CREDENTIALS=/secrets/snapbudd-1-sa.json
STRIPE_SECRET_KEY=sk_live_...
PLATFORM_FIXED_FEE_NOK=29
PLATFORM_PERCENT_FEE=0.1
GOOGLE_MAPS_API_KEY=...
API_BASE_URL=https://api.snapbudd.io
MERCHANT_TRACKING_BASE_URL=https://snapbudd.io/merchant/track
CORS_ORIGINS=https://your-shop.com,https://www.your-shop.com
```

### Firebase credentials on cloud hosts

**Option A — File mount (Cloud Run / GKE)**

1. Create a secret from the service account JSON
2. Mount it as a file
3. Set `GOOGLE_APPLICATION_CREDENTIALS` to the mount path

**Option B — Application Default Credentials**

On GCP Cloud Run, attach a service account with roles:

- `Firebase Admin SDK Administrator Service Agent` or
- `Cloud Datastore User` + `Firebase Authentication Admin`

Then omit `GOOGLE_APPLICATION_CREDENTIALS`; ADC is used automatically.

## Build & run

```bash
npm ci
npm run build
npm run start:prod
```

The server listens on `PORT` (default `3000`).

## Deployment options

### Google Cloud Run (recommended for Firebase proximity)

```bash
# From snapbudd-api directory
gcloud run deploy snapbudd-api \
  --source . \
  --region europe-north1 \
  --allow-unauthenticated \
  --set-env-vars FIREBASE_PROJECT_ID=snapbudd-1,API_BASE_URL=https://api.snapbudd.io \
  --set-secrets STRIPE_SECRET_KEY=stripe-secret:latest,GOOGLE_MAPS_API_KEY=maps-key:latest
```

Attach a service account with Firestore access instead of mounting JSON when possible.

### Docker

Create `Dockerfile`:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

```bash
docker build -t snapbudd-api .
docker run -p 3000:3000 --env-file .env snapbudd-api
```

### Railway / Render / Fly.io

1. Connect the `snapbudd-api` Git repository
2. Build command: `npm run build`
3. Start command: `npm run start:prod`
4. Add all environment variables from `.env.example`
5. Upload service account JSON as a secret file if needed

## Post-deployment checklist

- [ ] `GET /health` returns `{ "status": "ok" }`
- [ ] Merchant portal `.env` has `SNAPBUDD_API_BASE_URL` pointing to deployed API
- [ ] Generate API key from Merchant Portal → API access
- [ ] Test `POST /v1/orders` with curl
- [ ] Verify order appears in Firestore `orders` collection
- [ ] Verify order is visible in SnapBudd driver app feed
- [ ] Test bid checkout + finalize with Stripe test mode
- [ ] Set `CORS_ORIGINS` to your shop domains (avoid `*` in production)

## Merchant portal configuration

Update `snapbudd_merchant/assets/.env`:

```
SNAPBUDD_API_BASE_URL=https://api.snapbudd.io
```

Rebuild/redeploy the merchant portal web app after changing this value.

## Monitoring

- Watch Cloud Run / host logs for `VALIDATION_ERROR` and `UNAUTHORIZED`
- Monitor Firestore write errors
- Monitor Stripe checkout failures

## Rollback

The API only writes new merchant-api orders (`source.channel: "api"`). Rolling back the API service does not affect existing SnapBudd apps. No database migration is required.

## Security hardening (production)

1. Restrict `CORS_ORIGINS` to known shop domains
2. Put API behind HTTPS only
3. Rate-limit at load balancer (e.g. Cloud Armor, nginx)
4. Rotate API keys periodically via Merchant Portal
5. Use Stripe live keys only in production
6. Do not commit service account JSON or `.env` files
