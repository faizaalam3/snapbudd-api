# SnapBudd Merchant API

REST API for external shop websites to create delivery orders, list driver bids, accept bids via Stripe Checkout, and track order status.

Built with **NestJS 11** and **Firebase Admin SDK**, writing to the same Firestore collections used by the SnapBudd mobile app and merchant portal (`snapbudd-1`).

## Quick start (local)

1. Copy environment file:

```bash
cp .env.example .env
```

2. Download a Firebase service account JSON for project `snapbudd-1`:
   - Firebase Console → Project Settings → Service Accounts → Generate new private key
   - Save the file outside the repo and set `GOOGLE_APPLICATION_CREDENTIALS` in `.env`

3. Set Stripe secret key (same key used by SnapBudd Cloud Functions).

4. Install and run:

```bash
npm install
npm run start:dev
```

5. Health check: `GET http://localhost:3000/health`

## Authentication

All merchant order endpoints require:

| Header | Description |
|--------|-------------|
| `X-Merchant-Id` | Your merchant profile ID from the SnapBudd Merchant Portal |
| `X-Api-Key` | API key generated in Merchant Portal → API access |

Merchants must be **approved** before API calls are accepted.

Portal endpoints (`/v1/portal/*`) use Firebase ID token:

```
Authorization: Bearer <firebase_id_token>
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health |
| `POST` | `/v1/orders` | Create order |
| `GET` | `/v1/orders/:orderId` | Track order |
| `GET` | `/v1/orders/:orderId/bids` | List bids |
| `POST` | `/v1/orders/:orderId/bids/:bidId/checkout` | Start Stripe checkout |
| `POST` | `/v1/orders/:orderId/bids/:bidId/finalize` | Finalize after payment |
| `GET` | `/v1/portal/credentials` | Portal: view API credentials metadata |
| `POST` | `/v1/portal/api-key/generate` | Portal: generate API key |

See [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) for request/response schemas and integration flow.

## Deployment

| Guide | Use when |
|-------|----------|
| [`docs/DEPLOY_SNAPBUDD_IO.md`](docs/DEPLOY_SNAPBUDD_IO.md) | **Production** — `api.snapbudd.io` on Google Cloud Run (recommended) |
| [`docs/DEPLOY_RENDER.md`](docs/DEPLOY_RENDER.md) | Quick free trial on Render |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | General deployment reference |

## Merchant onboarding flow

1. Merchant signs up at **SnapBudd Merchant Portal** (`snapbudd_merchant`)
2. Creates workspace → submits business profile → admin approves in `snapbudd_admin`
3. After approval, merchant opens **API access** to copy Merchant ID and generate API key
4. Shop website backend calls this API (never expose the API key in frontend JS)

## Project structure

```
src/
  orders/          # Order create, track, bids, checkout
  portal/          # API key management for merchant portal
  firebase/        # Firebase Admin initialization
  pricing/         # Route/pricing engine (matches merchant portal)
  service-area/    # Service area validation from Firestore config
  common/          # Guards, filters, shared types
```

## Validation

All create-order fields are validated with `class-validator` before any Firestore write. Invalid payloads return `400` with structured errors so bad data cannot crash the main SnapBudd apps.

## Related projects

| Project | Role |
|---------|------|
| `Snapbudd` | Consumer/driver app + Cloud Functions |
| `snapbudd_merchant` | Merchant portal (account, API key, guide, tracking) |
| `snapbudd_admin` | Admin approval |
| `snapbudd_company` | Delivery company portal |

This API does **not** modify those projects.
