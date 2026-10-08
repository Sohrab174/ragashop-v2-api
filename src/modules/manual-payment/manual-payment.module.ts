import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderModule } from '../order/order.module';
import { ManualPaymentMethodEntity } from './entities/manual-payment-method.entity';
import { BankDestinationEntity } from './entities/bank-destination.entity';
import { PaymentSubmissionEntity } from './entities/payment-submission.entity';
import { PaymentEvidenceEntity } from './entities/payment-evidence.entity';
import { PaymentReviewEventEntity } from './entities/payment-review-event.entity';
import { PrivateReceiptObjectEntity } from './entities/private-receipt-object.entity';
import { OrderEntity } from '../order/entities/order.entity';
import { SettingEntity } from '../setting/entities/setting.entity';
import { ManualPaymentMethodService } from './manual-payment-method.service';
import { BankDestinationService } from './bank-destination.service';
import { PaymentSubmissionService } from './payment-submission.service';
import { PrivateReceiptStorageService } from './private-receipt-storage.service';
import { ManualPaymentController } from './manual-payment.controller';
import { CapabilityModule } from '../auth/capability/capability.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ManualPaymentMethodEntity,
      BankDestinationEntity,
      PaymentSubmissionEntity,
      PaymentEvidenceEntity,
      PaymentReviewEventEntity,
      PrivateReceiptObjectEntity,
      OrderEntity,
      SettingEntity,
    ]),
    forwardRef(() => OrderModule),
    CapabilityModule,
  ],
  controllers: [ManualPaymentController],
  providers: [
    ManualPaymentMethodService,
    BankDestinationService,
    PaymentSubmissionService,
    PrivateReceiptStorageService,
  ],
  exports: [
    PaymentSubmissionService,
    ManualPaymentMethodService,
    BankDestinationService,
    CapabilityModule,
  ],
})
export class ManualPaymentModule {}
