import { Module } from '@nestjs/common';
import { DpoPayService } from './dpo-pay.service';

@Module({
  providers: [DpoPayService],
  exports: [DpoPayService],
})
export class DpoPayModule {}
