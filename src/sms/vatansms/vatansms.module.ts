import { Module } from '@nestjs/common';
import { VatansmsService } from './vatansms.service';

@Module({
  providers: [VatansmsService],
  exports: [VatansmsService],
})
export class VatansmsModule {}
