# Deploy SnapBudd API on Render (free)

Render’s **free Web Service** tier is a good fit for this API. The service sleeps after ~15 minutes of inactivity and wakes on the next request (cold start ~30–60s).

## Before you start

Have these ready:

| Secret | Source |
|--------|--------|
| Firebase service account JSON | Firebase Console → `snapbudd-1` → Service Accounts → Generate key |
| `STRIPE_SECRET_KEY` | `Snapbudd/functions/.env` or `firebase functions:config:get` |
| `GOOGLE_MAPS_API_KEY` | `snapbudd_merchant/assets/.env` |

## Option A — Deploy with Render Dashboard (recommended)

### 1. Push `snapbudd-api` to GitHub

If it is not on GitHub yet:

```bash
cd /Users/faiz/StudioProjects/snapbudd-api
git add .
git commit -m "Prepare API for Render deployment"
# Create repo on GitHub, then:
git remote add origin https://github.com/YOUR_USER/snapbudd-api.git
git push -u origin master
```

### 2. Create Render account

1. Go to [https://render.com](https://render.com) and sign up (GitHub login is easiest).
2. **New** → **Web Service**.
3. Connect your `snapbudd-api` repository.

### 3. Service settings

| Field | Value |
|-------|--------|
| Name | `snapbudd-api` |
| Region | Frankfurt (closest to Norway) |
| Branch | `master` |
| Runtime | **Docker** |
| Plan | **Free** |
| Health check path | `/health` |

Render sets `PORT` automatically — do not hardcode it.

### 4. Environment variables

In **Environment** → **Add environment variable**:

| Key | Value |
|-----|--------|
| `NODE_ENV` | `production` |
| `FIREBASE_PROJECT_ID` | `snapbudd-1` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Paste the **entire** service account JSON (one line is fine) |
| `STRIPE_SECRET_KEY` | From Snapbudd functions config |
| `GOOGLE_MAPS_API_KEY` | From merchant `.env` |
| `PLATFORM_FIXED_FEE_NOK` | `29` |
| `PLATFORM_PERCENT_FEE` | `0.1` |
| `MERCHANT_TRACKING_BASE_URL` | `https://snapbudd.io/merchant/track` |
| `CORS_ORIGINS` | `*` (tighten later) |
| `API_BASE_URL` | Leave empty for first deploy; set after step 6 |

Mark `FIREBASE_SERVICE_ACCOUNT_JSON`, `STRIPE_SECRET_KEY`, and `GOOGLE_MAPS_API_KEY` as **Secret**.

### 5. Deploy

Click **Create Web Service**. Wait for the Docker build to finish.

Your URL will look like:

```
https://snapbudd-api.onrender.com
```

### 6. Set `API_BASE_URL` and redeploy

Add or update:

```
API_BASE_URL=https://snapbudd-api.onrender.com
```

(Use your actual Render URL.) Trigger a manual redeploy.

### 7. Verify

```bash
curl https://snapbudd-api.onrender.com/health
```

Expected:

```json
{"status":"ok","service":"snapbudd-api","version":"1.0.0"}
```

### 8. Point merchant portal at production API

In `snapbudd_merchant/assets/.env`:

```
SNAPBUDD_API_BASE_URL=https://snapbudd-api.onrender.com
```

Rebuild and redeploy the merchant portal.

---

## Option B — One-line JSON for `FIREBASE_SERVICE_ACCOUNT_JSON`

From your Mac, minify the JSON file:

```bash
python3 -c "import json; print(json.dumps(json.load(open('/Users/faiz/StudioProjects/snapbudd-api/secrets/snapbudd-1-service-account.json'))))"
```

Copy the output into Render’s `FIREBASE_SERVICE_ACCOUNT_JSON` secret field.

---

## Option C — Render Blueprint (`render.yaml`)

If the repo includes `render.yaml`:

1. Render Dashboard → **New** → **Blueprint**
2. Select the repo
3. Fill in secret env vars when prompted
4. Deploy

---

## Free tier limits

- Service **sleeps** when idle (~15 min)
- **750 hours/month** free (enough for one always-on service if traffic keeps it warm)
- Cold starts after sleep
- No custom domain on free tier (you get `*.onrender.com`)

For production with no sleep, upgrade to Render Starter ($7/mo) or use Google Cloud Run.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Build fails | Check Render build logs; ensure `Dockerfile` is at repo root |
| `health` fails | App crashed on boot — check logs for Firebase/Stripe env errors |
| Firebase permission denied | Service account needs Firestore access on `snapbudd-1` |
| Merchant portal can’t reach API | Set `SNAPBUDD_API_BASE_URL` and CORS if needed |

---

## Other free hosts

| Host | Notes |
|------|--------|
| [Fly.io](https://fly.io) | Free allowance, needs `fly launch` + Dockerfile |
| [Railway](https://railway.app) | Limited free credits per month |
| Google Cloud Run | Best Firebase fit; requires billing account (free tier within limits) |

Render is the simplest starting point for a free public URL.
