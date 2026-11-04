import {
  BadRequestException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MerchantPaymentService {
  constructor(private readonly config: ConfigService) {}

  async execute(
    merchantId: string,
    apiKey: string,
    orderId: string,
    action: 'checkout' | 'payment' | 'verify',
    returnUrl?: string,
  ) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(orderId))
      throw new BadRequestException('Invalid order ID');
    const endpoint = this.config.get<string>('merchantPaymentUrl');
    if (!endpoint)
      throw new ServiceUnavailableException(
        'Delivery payment service is not configured',
      );
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Merchant-Id': merchantId,
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify({ orderId, action, returnUrl }),
        signal: AbortSignal.timeout(60000),
        redirect: 'error',
      });
    } catch {
      throw new ServiceUnavailableException(
        'Payment request interrupted. Retry the same order to recover its payment.',
      );
    }
    let result: Record<string, unknown>;
    try {
      result = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new ServiceUnavailableException(
        'Payment service returned an invalid response. Retry the same order.',
      );
    }
    if (!response.ok)
      throw new HttpException(
        typeof result.message === 'string'
          ? result.message
          : 'Payment could not be completed',
        [400, 401, 403, 404, 409].includes(response.status)
          ? response.status
          : 503,
      );
    return result;
  }
}
