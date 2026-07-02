# Deploy SnapBudd API on api.snapbudd.io (Google Cloud Run)

This is the **recommended** production setup for your domain. It uses the same Google Cloud project as Firebase (`snapbudd-1`), is much faster than Render’s free tier, and maps cleanly to:

```
https://api.snapbudd.io
```

Firebase Hosting on `snapbudd.io` serves static Flutter web apps only — it **cannot** run the NestJS API directly. Cloud Run runs the API; DNS points `api.snapbudd.io` to it.

---

## Why Cloud Run vs Render?

| | Render (free) | Cloud Run |
|--|---------------|-----------|
| Cold start | Slow (~30–60s) | Faster (~1–5s) |
| Region | US/EU varies | `europe-north1` (Oslo area) |
| Firebase | Extra network hop | Same GCP project |
| Custom domain | `*.onrender.com` only on free | `api.snapbudd.io` |
| Cost | Free (sleeps) | Free tier with billing account |

---

## Prerequisites

1. **Google Cloud billing** enabled on project `snapbudd-1` (free tier still applies; you won’t be charged for light API usage)
2. **Google Cloud SDK** installed: [cloud.google.com/sdk](https://cloud.google.com/sdk/docs/install)
3. **Domain DNS access** for `snapbudd.io` (where you manage DNS — Cloudflare, Namecheap, Google Domains, etc.)
4. Local `.env` with Stripe, Maps, and Firebase credentials (or set via console after deploy)

---

## Step 1 — Login and enable APIs

```bash
gcloud auth login
gcloud config set project snapbudd-1

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

---

## Step 2 — Deploy the API

From the `snapbudd-api` folder:

```bash
chmod +x scripts/deploy-cloud-run.sh
./scripts/deploy-cloud-run.sh
```

Or manually:

```bash
cd /Users/faiz/StudioProjects/snapbudd-api

gcloud run deploy snapbudd-api \
  --source . \
  --region europe-north1 \
  --allow-unauthenticated \
  --port 3000 \
  --set-env-vars "NODE_ENV=production,FIREBASE_PROJECT_ID=snapbudd-1,API_BASE_URL=https://api.snapbudd.io,MERCHANT_TRACKING_BASE_URL=https://snapbudd.io/merchant/track,PLATFORM_FIXED_FEE_NOK=29,PLATFORM_PERCENT_FEE=0.1,CORS_ORIGINS=*"
```

Add secrets in **Cloud Run → snapbudd-api → Edit & deploy → Variables & secrets**:

| Variable | Value |
|----------|--------|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Full service account JSON (one line) |
| `STRIPE_SECRET_KEY` | From Snapbudd functions |
| `GOOGLE_MAPS_API_KEY` | From merchant `.env` |

Test the Cloud Run URL (shown after deploy):

```bash
curl https://snapbudd-api-XXXXX-ew.a.run.app/health
```

---

## Step 3 — Map `api.snapbudd.io` custom domain

### In Google Cloud Console

1. Open [Cloud Run](https://console.cloud.google.com/run?project=snapbudd-1)
2. Click **snapbudd-api** → **Manage custom domains**
3. **Add mapping** → Base domain: `snapbudd.io` → Subdomain: `api`
4. Google will show DNS records to add (usually a **CNAME** or **A/AAAA** records)

### In your DNS provider (where snapbudd.io is managed)

Add the records Google gives you. Typical setup:

| Type | Name | Value |
|------|------|--------|
| `CNAME` | `api` | `ghs.googlehosted.com` (or value from Cloud Run wizard) |

If you use **Cloudflare**:

- Set proxy to **DNS only** (grey cloud) initially until SSL is verified, or use **Full** SSL
- Cloud Run provisions a managed certificate automatically

Wait 15–60 minutes for DNS + SSL propagation.

### Verify

```bash
curl https://api.snapbudd.io/health
```

Expected:

```json
{"status":"ok","service":"snapbudd-api","version":"1.0.0"}
```

---

## Step 4 — Update merchant portal

In `snapbudd_merchant/assets/.env`:

```
SNAPBUDD_API_BASE_URL=https://api.snapbudd.io
```

Rebuild and redeploy the merchant portal to Firebase Hosting.

---

## Step 5 — (Optional) Keep Render as fallback

You can run both during migration. Point `SNAPBUDD_API_BASE_URL` only to `api.snapbudd.io` once verified.

---

## Production hardening

1. **Secrets** — Move `STRIPE_SECRET_KEY` and `FIREBASE_SERVICE_ACCOUNT_JSON` to [Secret Manager](https://cloud.google.com/secret-manager) instead of plain env vars
2. **Min instances** — Set `--min-instances 1` to avoid cold starts (~$5–10/mo)
3. **CORS** — Change `CORS_ORIGINS` from `*` to your shop domains
4. **Rate limiting** — Add Cloud Armor or API Gateway later

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `403` on deploy | Enable Cloud Build + Cloud Run APIs; check IAM |
| Firebase errors on boot | Verify `FIREBASE_SERVICE_ACCOUNT_JSON` in Cloud Run env |
| SSL pending on api.snapbudd.io | Wait for DNS; check CNAME points to Google |
| Slow first request | Cold start — set `min-instances=1` |

---

## Architecture

```
snapbudd.io          → Firebase Hosting (main site, /merchant/, /company/)
api.snapbudd.io      → Cloud Run (snapbudd-api NestJS)
snapbudd-1 Firestore → shared by all apps
```

No changes needed to `Snapbudd`, `snapbudd_admin`, or `snapbudd_company` code.
