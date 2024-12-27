import { Module } from '@nestjs/common';
import { SepGatewayService } from './sep-gateway.service';

@Module({
  providers: [SepGatewayService],
  exports: [SepGatewayService],
})
export class SepGatewayModule {}
