import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller';

@Module({
  controllers: [PortalController],
})
export class PortalModule {}
