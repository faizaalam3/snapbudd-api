import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { MerchantContext } from '../types/merchant-context';

export const CurrentMerchant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): MerchantContext => {
    const request = ctx.switchToHttp().getRequest<Request & { merchant: MerchantContext }>();
    return request.merchant;
  },
);

export const CurrentFirebaseUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): { uid: string; merchantId: string } => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { firebaseUser: { uid: string; merchantId: string } }>();
    return request.firebaseUser;
  },
);
