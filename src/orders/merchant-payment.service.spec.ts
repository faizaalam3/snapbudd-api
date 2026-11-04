/* eslint-disable @typescript-eslint/require-await -- Async service test doubles. */
import { ConfigService } from '@nestjs/config';
import { MerchantPaymentService } from './merchant-payment.service';
const fetchOriginal = global.fetch;
afterEach(() => {
  global.fetch = fetchOriginal;
});
it('forwards only the saved order and merchant credentials to the payment backend', async () => {
  const fetcher = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      sessionId: 'cs_1',
      url: 'https://checkout.stripe.com/test',
    }),
  });
  global.fetch = fetcher;
  const service = new MerchantPaymentService({
    get: () => 'https://functions.test/payment',
  } as unknown as ConfigService);
  const result = await service.execute(
    'merchant',
    'secret',
    'order',
    'checkout',
    'https://shop.test/return',
  );
  expect(result.sessionId).toBe('cs_1');
  const options = (
    fetcher.mock.calls as unknown as Array<[string, RequestInit]>
  )[0][1];
  expect(JSON.parse(options.body as string)).toEqual({
    orderId: 'order',
    action: 'checkout',
    returnUrl: 'https://shop.test/return',
  });
  expect(options.redirect).toBe('error');
  expect(options.headers).toMatchObject({
    'X-Merchant-Id': 'merchant',
    'X-Api-Key': 'secret',
  });
});
it('preserves payment conflicts and never treats network failure as confirmed', async () => {
  const service = new MerchantPaymentService({
    get: () => 'https://functions.test/payment',
  } as unknown as ConfigService);
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({ message: 'Resolve saved payment' }),
  });
  await expect(
    service.execute('merchant', 'key', 'order', 'verify'),
  ).rejects.toMatchObject({ status: 409 });
  global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));
  await expect(
    service.execute('merchant', 'key', 'order', 'checkout'),
  ).rejects.toMatchObject({ status: 503 });
});
