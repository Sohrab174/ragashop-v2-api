import { Module } from '@nestjs/common';
import { AmootsmsModule } from '../amootsms/amootsms.module';
import { VatansmsModule } from '../vatansms/vatansms.module';
import { OtpDeliveryService } from './otp-delivery.service';

@Module({
  imports: [AmootsmsModule, VatansmsModule],
  providers: [OtpDeliveryService],
  exports: [OtpDeliveryService],
})
export class OtpDeliveryModule {}
