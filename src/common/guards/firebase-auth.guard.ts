import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { FirebaseService } from '../../firebase/firebase.service';
import { COLLECTIONS } from '../constants/firestore.constants';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
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

    try {
      const decoded = await this.firebase.auth.verifyIdToken(token);
      const uid = decoded.uid;

      const membership = await this.firebase.db
        .collection(COLLECTIONS.merchantUsers)
        .doc(uid)
        .get();

      const merchantId = (membership.data()?.merchantId ?? '').toString();
      if (!merchantId) {
        throw new ForbiddenException('No merchant workspace linked to this user');
      }

      (
        request as Request & { firebaseUser: { uid: string; merchantId: string } }
      ).firebaseUser = { uid, merchantId };

      return true;
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired Firebase token');
    }
  }
}
