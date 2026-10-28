import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { FirebaseService } from '../../firebase/firebase.service';
import {
  COLLECTIONS,
  APPROVED_MERCHANT_STATUS,
} from '../constants/firestore.constants';
import { MerchantContext } from '../types/merchant-context';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

@Injectable()
export class MerchantApiKeyGuard implements CanActivate {
  constructor(private readonly firebase: FirebaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const merchantId = this.readHeader(request, 'x-merchant-id');
    const apiKey = this.readHeader(request, 'x-api-key');

    if (!merchantId || !apiKey) {
      throw new UnauthorizedException(
        'X-Merchant-Id and X-Api-Key headers are required',
      );
    }

    const merchantSnap = await this.firebase.db
      .collection(COLLECTIONS.merchantProfiles)
      .doc(merchantId)
      .get();

    if (!merchantSnap.exists) {
      throw new UnauthorizedException('Invalid merchant credentials');
    }

    const merchant = asRecord(merchantSnap.data());
    const status = asString(merchant.status).toLowerCase();
    if (status !== APPROVED_MERCHANT_STATUS) {
      throw new ForbiddenException(
        'Merchant account must be approved before using the API',
      );
    }

    const api = asRecord(merchant.api);
    const storedHash = asString(api.keyHash);
    const storedPrefix = asString(api.keyPrefix);

    if (!storedHash) {
      throw new ForbiddenException(
        'No API key configured. Generate one in the SnapBudd Merchant Portal.',
      );
    }

    if (!this.verifyApiKey(apiKey, storedHash, storedPrefix)) {
      throw new UnauthorizedException('Invalid merchant credentials');
    }

    const owner = asRecord(merchant.owner);
    const shop = asRecord(merchant.shop);

    const merchantContext: MerchantContext = {
      merchantId,
      status,
      displayName:
        asString(shop.displayName) || asString(merchant.name) || merchantId,
      ownerUid:
        asString(owner.uid) ||
        asString(owner.ownerUid) ||
        asString(merchant.ownerUid),
    };

    (request as Request & { merchant: MerchantContext }).merchant =
      merchantContext;

    await merchantSnap.ref.set(
      {
        api: {
          lastUsedAt: this.firebase.serverTimestamp(),
        },
        updatedAt: this.firebase.serverTimestamp(),
      },
      { merge: true },
    );

    return true;
  }

  private readHeader(request: Request, name: string): string {
    const value = request.headers[name];
    if (Array.isArray(value)) return value[0]?.trim() ?? '';
    return typeof value === 'string' ? value.trim() : '';
  }

  private verifyApiKey(
    provided: string,
    storedHash: string,
    storedPrefix: string,
  ): boolean {
    if (storedPrefix && !provided.startsWith(storedPrefix)) {
      return false;
    }
    const hash = createHash('sha256').update(provided).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
    } catch {
      return false;
    }
  }
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

export function generateApiKey(): { key: string; prefix: string } {
  const random = createHash('sha256')
    .update(`${Date.now()}-${Math.random()}`)
    .digest('hex')
    .slice(0, 32);
  const key = `sb_live_${random}`;
  return { key, prefix: key.slice(0, 12) };
}
