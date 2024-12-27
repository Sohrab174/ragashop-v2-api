import { Module } from '@nestjs/common';
import { ZarinpalService } from './zarinpal.service';

@Module({
  providers: [ZarinpalService],
  exports: [ZarinpalService],
})
export class ZarinpalModule {}
