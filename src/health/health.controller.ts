import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'snapbudd-api',
      version: '1.0.0',
    };
  }

  @Get('v1/health')
  healthV1() {
    return this.health();
  }
}
