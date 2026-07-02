import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PricingService } from '../pricing/pricing.service';
import { ServiceAreaService } from '../service-area/service-area.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, PricingService, ServiceAreaService],
})
export class OrdersModule {}
