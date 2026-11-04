# SnapBudd Merchant API

REST API for external shop websites to create fixed-price deliveries, select owned pickup outlets, verify delivery payment, receive tracking IDs and follow assigned drivers.

Built with **NestJS 11** and **Firebase Admin SDK**, writing to the same Firestore collections used by the SnapBudd mobile app and merchant portal (`snapbudd-1`).

## Live API

| Environment | Base URL |
|-------------|----------|
| Production (Render) | `https://snapbudd-api.onrender.com` |
| Local development | `http://localhost:3000` |

Health check:

```bash
curl https://snapbudd-api.onrender.com/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "snapbudd-api",
  "version": "1.0.0"
}
```

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
| `GET` | `/v1/orders/outlets` | List your saved outlets (merchant API authentication) |
| `GET` | `/v1/orders/:orderId` | Track order |
| `GET` | `/v1/orders/connection` | Validate account/key and capabilities |
| `GET` | `/v1/orders?after=<cursor>` | Paginate orders across all owned outlets |
| `POST` | `/v1/orders/:orderId/checkout` | Fixed-price hosted checkout |
| `POST` | `/v1/orders/:orderId/payment` | Fixed-price embedded payment |
| `POST` | `/v1/orders/:orderId/payment/verify` | Verify saved Stripe funding |
| `GET` | `/v1/portal/credentials` | Portal: view API credentials metadata |
| `POST` | `/v1/portal/api-key/generate` | Portal: generate API key |

See [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) for request/response schemas and integration flow.

### Outlet pickup

Create and edit outlets in the shared portal's **Outlets** page. Deactivate an
outlet to stop new pickups without deleting its historical order attribution.
`GET /v1/orders/outlets` returns saved outlet IDs, names, addresses, coordinates,
contacts and `active` flags. Filter for `active: true` when offering pickup choices.

Pass `outletId` to `POST /v1/orders` instead of `pickup` and `pickupContact`.
The API loads the outlet from your own merchant profile and uses its saved pickup
location and contact. You may provide `pickupContact` to override the contact for
this order; supplied pickup coordinates never override the selected outlet.
Alternatively send `selectNearestOutlet: true` with confirmed delivery coordinates. Without either selection, provide manual pickup details.

Use `Idempotency-Key` for safe create retries. Creation returns an immediate 10-character `trackingId`; payment is required before publication. See the developer guide for funding and recovery.

Orders retain `source.outletId` and `source.outletName` so editing or deactivating
an outlet does not alter existing pickups. Reporting separates completed delivery
spend from declared merchandise value; neither represents merchant sales revenue.

Deploy the updated Cloud Functions address lookup, Firestore rules, API and
shared portal together before using outlets. No existing merchant data migration
is required; previous orders appear as manual / legacy pickup orders.

Use [docs/WEBSITE_DEVELOPER_HANDOFF.md](docs/WEBSITE_DEVELOPER_HANDOFF.md) when sending setup instructions to external website developers.

## Deployment

| Guide | Use when |
|-------|----------|
| [`docs/DEPLOY_SNAPBUDD_IO.md`](docs/DEPLOY_SNAPBUDD_IO.md) | **Production** — `api.snapbudd.io` on Google Cloud Run (recommended) |
| [`docs/DEPLOY_RENDER.md`](docs/DEPLOY_RENDER.md) | Quick free trial on Render |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | General deployment reference |

## Merchant onboarding flow

1. Merchant signs up at https://snapbudd.io/portal/?workspace=merchant
2. Creates workspace → submits business profile → admin approves in `snapbudd_admin`
3. After approval, merchant opens **API access** to copy Merchant ID and generate API key
4. Shop website backend calls this API (never expose the API key in frontend JS)

## Project structure

```
src/
  orders/          # Idempotent creation, outlets, tracking and fixed payment
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

Fixed payment routes use the shared Cloud Functions payment/reconciliation flow. Deploy `merchantDeliveryPayment` with this API; set `MERCHANT_PAYMENT_URL` when overriding its default project/region.
