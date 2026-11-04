import {
  Controller,
  Headers,
  Query,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MerchantApiKeyGuard } from '../common/guards/merchant-api-key.guard';
import { CurrentMerchant } from '../common/decorators/current-merchant.decorator';
import type { MerchantContext } from '../common/types/merchant-context';
import { MerchantPaymentService } from './merchant-payment.service';
import { OrdersService } from './orders.service';
import { AcceptBidDto, CreateOrderDto, FinalizeBidDto } from './dto/orders.dto';

@Controller('v1/orders')
@UseGuards(MerchantApiKeyGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly payments: MerchantPaymentService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createOrder(
    @CurrentMerchant() merchant: MerchantContext,
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.ordersService.createOrder(merchant, dto, key);
  }

  @Get('connection')
  connection(@CurrentMerchant() merchant: MerchantContext) {
    return {
      status: 'ok',
      merchantId: merchant.merchantId,
      capabilities: [
        'fixed_price',
        'outlets',
        'checkout',
        'payment_intent',
        'tracking',
        'idempotent_create',
      ],
    };
  }

  @Get()
  listOrders(
    @CurrentMerchant() merchant: MerchantContext,
    @Query('after') after?: string,
  ) {
    return this.ordersService.listOrders(merchant, after);
  }

  @Post(':orderId/checkout')
  @HttpCode(HttpStatus.OK)
  checkout(
    @CurrentMerchant() merchant: MerchantContext,
    @Headers('x-api-key') key: string,
    @Param('orderId') orderId: string,
    @Body() dto: AcceptBidDto,
  ) {
    return this.payments.execute(
      merchant.merchantId,
      key,
      orderId,
      'checkout',
      dto.returnUrl,
    );
  }

  @Post(':orderId/payment')
  @HttpCode(HttpStatus.OK)
  payment(
    @CurrentMerchant() merchant: MerchantContext,
    @Headers('x-api-key') key: string,
    @Param('orderId') orderId: string,
  ) {
    return this.payments.execute(merchant.merchantId, key, orderId, 'payment');
  }

  @Post(':orderId/payment/verify')
  @HttpCode(HttpStatus.OK)
  verifyPayment(
    @CurrentMerchant() merchant: MerchantContext,
    @Headers('x-api-key') key: string,
    @Param('orderId') orderId: string,
  ) {
    return this.payments.execute(merchant.merchantId, key, orderId, 'verify');
  }

  @Get('outlets')
  listOutlets(@CurrentMerchant() merchant: MerchantContext) {
    return this.ordersService.listOutlets(merchant);
  }

  @Get(':orderId')
  getOrder(
    @CurrentMerchant() merchant: MerchantContext,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.getOrder(merchant, orderId);
  }

  @Get(':orderId/bids')
  listBids(
    @CurrentMerchant() merchant: MerchantContext,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.listBids(merchant, orderId);
  }

  @Post(':orderId/bids/:bidId/checkout')
  @HttpCode(HttpStatus.OK)
  createBidCheckout(
    @CurrentMerchant() merchant: MerchantContext,
    @Param('orderId') orderId: string,
    @Param('bidId') bidId: string,
    @Body() dto: AcceptBidDto,
  ) {
    return this.ordersService.createBidCheckout(
      merchant,
      orderId,
      bidId,
      dto.returnUrl,
    );
  }

  @Post(':orderId/bids/:bidId/reject')
  @HttpCode(HttpStatus.OK)
  rejectBid(
    @CurrentMerchant() merchant: MerchantContext,
    @Param('orderId') orderId: string,
    @Param('bidId') bidId: string,
  ) {
    return this.ordersService.rejectBid(merchant, orderId, bidId);
  }

  @Post(':orderId/bids/:bidId/finalize')
  @HttpCode(HttpStatus.OK)
  finalizeBid(
    @CurrentMerchant() merchant: MerchantContext,
    @Param('orderId') orderId: string,
    @Param('bidId') bidId: string,
    @Body() dto: FinalizeBidDto,
  ) {
    return this.ordersService.finalizeBid(
      merchant,
      orderId,
      bidId,
      dto.sessionId,
    );
  }
}
