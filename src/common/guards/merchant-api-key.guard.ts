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
import { COLLECTIONS, APPROVED_MERCHANT_STATUS } from '../constants/firestore.constants';
import { MerchantContext } from '../types/merchant-context';

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

    const merchant = merchantSnap.data() ?? {};
    const status = (merchant.status ?? '').toString().toLowerCase();
    if (status !== APPROVED_MERCHANT_STATUS) {
      throw new ForbiddenException(
        'Merchant account must be approved before using the API',
      );
    }

    const api = (merchant.api as Record<string, unknown> | undefined) ?? {};
    const storedHash = (api.keyHash ?? '').toString();
    const storedPrefix = (api.keyPrefix ?? '').toString();

    if (!storedHash) {
      throw new ForbiddenException(
        'No API key configured. Generate one in the SnapBudd Merchant Portal.',
      );
    }

    if (!this.verifyApiKey(apiKey, storedHash, storedPrefix)) {
      throw new UnauthorizedException('Invalid merchant credentials');
    }

    const owner =
      (merchant.owner as Record<string, unknown> | undefined) ?? {};
    const shop = (merchant.shop as Record<string, unknown> | undefined) ?? {};

    const merchantContext: MerchantContext = {
      merchantId,
      status,
      displayName:
        (shop.displayName ?? merchant.name ?? '').toString() || merchantId,
      ownerUid: (
        owner.uid ??
        owner.ownerUid ??
        merchant.ownerUid ??
        ''
      ).toString(),
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
    return (value ?? '').toString().trim();
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
