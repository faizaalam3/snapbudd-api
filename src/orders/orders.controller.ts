import {
  Controller,
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
import { OrdersService } from './orders.service';
import {
  AcceptBidDto,
  CreateOrderDto,
  FinalizeBidDto,
} from './dto/orders.dto';

@Controller('v1/orders')
@UseGuards(MerchantApiKeyGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createOrder(
    @CurrentMerchant() merchant: MerchantContext,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(merchant, dto);
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
