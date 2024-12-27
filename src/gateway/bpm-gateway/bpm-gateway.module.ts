import { Module } from '@nestjs/common';
import { BpmGatewayService } from './bpm-gateway.service';

@Module({
  providers: [BpmGatewayService],
  exports: [BpmGatewayService],
})
export class BpmGatewayModule {}
