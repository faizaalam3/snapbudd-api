#!/usr/bin/env bash
# Deploy snapbudd-api to Google Cloud Run (project: snapbudd-1)
# Usage: ./scripts/deploy-cloud-run.sh
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-snapbudd-1}"
REGION="${GCP_REGION:-europe-north1}"
SERVICE_NAME="${CLOUD_RUN_SERVICE:-snapbudd-api}"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "Install Google Cloud SDK: https://cloud.google.com/sdk/docs/install"
  exit 1
fi

echo "→ Project: $PROJECT_ID | Region: $REGION | Service: $SERVICE_NAME"

gcloud config set project "$PROJECT_ID"

# Build env vars (non-secret). Add secrets via Secret Manager in production.
ENV_VARS="NODE_ENV=production"
ENV_VARS+=",FIREBASE_PROJECT_ID=snapbudd-1"
ENV_VARS+=",PLATFORM_FIXED_FEE_NOK=29"
ENV_VARS+=",PLATFORM_PERCENT_FEE=0.1"
ENV_VARS+=",MERCHANT_TRACKING_BASE_URL=https://snapbudd.io/merchant/track"
ENV_VARS+=",API_BASE_URL=https://api.snapbudd.io"
ENV_VARS+=",CORS_ORIGINS=*"

# Optional: load from local .env if present (never commit .env)
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source .env
  [[ -n "${GOOGLE_MAPS_API_KEY:-}" ]] && ENV_VARS+=",GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY}"
  [[ -n "${STRIPE_SECRET_KEY:-}" ]] && ENV_VARS+=",STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}"
  if [[ -n "${FIREBASE_SERVICE_ACCOUNT_JSON:-}" ]]; then
    ENV_VARS+=",FIREBASE_SERVICE_ACCOUNT_JSON=${FIREBASE_SERVICE_ACCOUNT_JSON}"
  elif [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" && -f "${GOOGLE_APPLICATION_CREDENTIALS}" ]]; then
    FIREBASE_SERVICE_ACCOUNT_JSON="$(python3 -c "import json; print(json.dumps(json.load(open('${GOOGLE_APPLICATION_CREDENTIALS}'))))")"
    ENV_VARS+=",FIREBASE_SERVICE_ACCOUNT_JSON=${FIREBASE_SERVICE_ACCOUNT_JSON}"
  fi
fi

echo "→ Deploying to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --set-env-vars "$ENV_VARS"

URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"
echo ""
echo "✓ Deployed: $URL"
echo "✓ Health:   $URL/health"
echo ""
echo "Next: map api.snapbudd.io → see docs/DEPLOY_SNAPBUDD_IO.md"
