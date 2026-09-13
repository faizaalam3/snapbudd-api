import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { FirebaseService } from '../../firebase/firebase.service';
import { COLLECTIONS } from '../constants/firestore.constants';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(FirebaseAuthGuard.name);
  constructor(private readonly firebase: FirebaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = (request.headers.authorization ?? '').toString();
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';

    if (!token) {
      throw new UnauthorizedException('Bearer token is required');
    }

    let uid: string;
    try {
      const decoded = await this.firebase.auth.verifyIdToken(token);
      uid = decoded.uid;
    } catch (error) {
      const code = this.safeErrorCode(error);
      if (
        [
          'auth/argument-error',
          'auth/invalid-id-token',
          'auth/id-token-expired',
          'auth/id-token-revoked',
          'auth/user-disabled',
        ].includes(code)
      ) {
        this.logger.warn(`Firebase token verification failed (${code})`);
        throw new UnauthorizedException(
          'Invalid or expired Firebase token. Sign in again; the portal and API must use the same Firebase project.',
        );
      }
      this.logger.error(`Firebase authentication service failed (${code})`);
      throw new ServiceUnavailableException(
        'The API cannot verify Firebase sign-in. Contact SnapBudd support to check API Firebase configuration.',
      );
    }

    let membership: FirebaseFirestore.DocumentSnapshot;
    try {
      membership = await this.firebase.db
        .collection(COLLECTIONS.merchantUsers)
        .doc(uid)
        .get();
    } catch (error) {
      this.logger.error(
        `Merchant workspace lookup failed (${this.safeErrorCode(error)})`,
      );
      throw new ServiceUnavailableException(
        'The API cannot load your merchant workspace. Contact SnapBudd support to check API database access.',
      );
    }

    const data = membership.data();
    const merchantId = (data?.merchantId ?? '').toString().trim();
    if (!merchantId) {
      throw new ForbiddenException('No merchant workspace linked to this user');
    }
    if (
      (data?.status ?? 'active').toString().trim().toLowerCase() !== 'active'
    ) {
      throw new ForbiddenException('Merchant workspace access is inactive');
    }

    (
      request as Request & { firebaseUser: { uid: string; merchantId: string } }
    ).firebaseUser = { uid, merchantId };

    return true;
  }

  private safeErrorCode(error: unknown): string {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
    return /^[a-zA-Z0-9_/-]{1,80}$/.test(code) ? code : 'unknown';
  }
}
