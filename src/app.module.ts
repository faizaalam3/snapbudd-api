import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { FirebaseModule } from './firebase/firebase.module';
import { OrdersModule } from './orders/orders.module';
import { PortalModule } from './portal/portal.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    FirebaseModule,
    OrdersModule,
    PortalModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
