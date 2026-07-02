import {
  Controller,
  Get,
  Post,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';
import { CurrentFirebaseUser } from '../common/decorators/current-merchant.decorator';
import { FirebaseService } from '../firebase/firebase.service';
import {
  COLLECTIONS,
  APPROVED_MERCHANT_STATUS,
} from '../common/constants/firestore.constants';
import {
  generateApiKey,
  hashApiKey,
} from '../common/guards/merchant-api-key.guard';

@Controller('v1/portal')
@UseGuards(FirebaseAuthGuard)
export class PortalController {
  constructor(private readonly firebase: FirebaseService) {}

  @Get('credentials')
  async getCredentials(
    @CurrentFirebaseUser() user: { uid: string; merchantId: string },
  ) {
    const snap = await this.firebase.db
      .collection(COLLECTIONS.merchantProfiles)
      .doc(user.merchantId)
      .get();
    if (!snap.exists) {
      throw new ForbiddenException('Merchant profile not found');
    }

    const data = snap.data() ?? {};
    const api = (data.api as Record<string, unknown>) ?? {};
    const shop = (data.shop as Record<string, unknown>) ?? {};
    const owner = (data.owner as Record<string, unknown>) ?? {};

    return {
      merchantId: user.merchantId,
      status: data.status,
      displayName: shop.displayName ?? data.name ?? user.merchantId,
      ownerEmail: owner.email ?? null,
      apiKeyPrefix: api.keyPrefix ?? null,
      apiKeyCreatedAt: api.createdAt ?? null,
      apiKeyLastUsedAt: api.lastUsedAt ?? null,
      hasApiKey: Boolean(api.keyHash),
    };
  }

  @Post('api-key/generate')
  async generateApiKey(
    @CurrentFirebaseUser() user: { uid: string; merchantId: string },
  ) {
    const ref = this.firebase.db
      .collection(COLLECTIONS.merchantProfiles)
      .doc(user.merchantId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new ForbiddenException('Merchant profile not found');
    }

    const data = snap.data() ?? {};
    const status = (data.status ?? '').toString().toLowerCase();
    if (status !== APPROVED_MERCHANT_STATUS) {
      throw new ForbiddenException(
        'API keys are available after your merchant account is approved',
      );
    }

    const { key, prefix } = generateApiKey();
    const now = this.firebase.serverTimestamp();

    await ref.set(
      {
        api: {
          keyHash: hashApiKey(key),
          keyPrefix: prefix,
          createdAt: now,
          createdByUid: user.uid,
          lastUsedAt: null,
        },
        updatedAt: now,
      },
      { merge: true },
    );

    return {
      merchantId: user.merchantId,
      apiKey: key,
      apiKeyPrefix: prefix,
      message:
        'Store this API key securely. It will not be shown again.',
    };
  }
}
