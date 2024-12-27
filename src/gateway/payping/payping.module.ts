import { Module } from '@nestjs/common';
import { PaypingService } from './payping.service';

@Module({
  providers: [PaypingService],
  exports: [PaypingService],
})
export class PaypingModule {}
