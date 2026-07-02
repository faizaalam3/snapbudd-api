import { readFileSync } from 'fs';
import {
  cert,
  applicationDefault,
  ServiceAccount,
} from 'firebase-admin/app';

export function resolveFirebaseCredential() {
  const jsonFromEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (jsonFromEnv) {
    const serviceAccount = JSON.parse(jsonFromEnv) as ServiceAccount;
    return cert(serviceAccount);
  }

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (credentialsPath) {
    const raw = readFileSync(credentialsPath, 'utf8');
    const serviceAccount = JSON.parse(raw) as ServiceAccount;
    return cert(serviceAccount);
  }

  return applicationDefault();
}
