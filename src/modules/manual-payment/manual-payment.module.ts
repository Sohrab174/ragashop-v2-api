import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderModule } from '../order/order.module';
import { ManualPaymentMethodEntity } from './entities/manual-payment-method.entity';
import { BankDestinationEntity } from './entities/bank-destination.entity';
import { PaymentSubmissionEntity } from './entities/payment-submission.entity';
import { PaymentEvidenceEntity } from './entities/payment-evidence.entity';
import { PaymentReviewEventEntity } from './entities/payment-review-event.entity';
import { PrivateReceiptObjectEntity } from './entities/private-receipt-object.entity';
import { UserCapabilityEntity } from './entities/user-capability.entity';
import { OrderEntity } from '../order/entities/order.entity';
import { SettingEntity } from '../setting/entities/setting.entity';
import { ManualPaymentMethodService } from './manual-payment-method.service';
import { BankDestinationService } from './bank-destination.service';
import { PaymentSubmissionService } from './payment-submission.service';
import { PrivateReceiptStorageService } from './private-receipt-storage.service';
import { UserCapabilityService } from './user-capability.service';
import { ManualPaymentController } from './manual-payment.controller';
import { PermissionsGuard } from '../auth/capability/permissions.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ManualPaymentMethodEntity,
      BankDestinationEntity,
      PaymentSubmissionEntity,
      PaymentEvidenceEntity,
      PaymentReviewEventEntity,
      PrivateReceiptObjectEntity,
      UserCapabilityEntity,
      OrderEntity,
      SettingEntity,
    ]),
    forwardRef(() => OrderModule),
  ],
  controllers: [ManualPaymentController],
  providers: [
    ManualPaymentMethodService,
    BankDestinationService,
    PaymentSubmissionService,
    PrivateReceiptStorageService,
    UserCapabilityService,
    PermissionsGuard,
  ],
  exports: [
    PaymentSubmissionService,
    UserCapabilityService,
    ManualPaymentMethodService,
    BankDestinationService,
  ],
})
export class ManualPaymentModule {}
