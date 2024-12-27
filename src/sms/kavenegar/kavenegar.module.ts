import { Module } from '@nestjs/common';
import { KavenegarService } from './kavenegar.service';

@Module({
  providers: [KavenegarService],
  exports: [KavenegarService],
})
export class KavenegarModule {}
