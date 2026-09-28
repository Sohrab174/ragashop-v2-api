import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderEntity } from '../order/entities/order.entity';
import { ManualPaymentModule } from '../manual-payment/manual-payment.module';
import { PermissionsGuard } from '../auth/capability/permissions.guard';
import { SupportRequestEntity } from './entities/support-request.entity';
import { SupportMessageEntity } from './entities/support-message.entity';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';

/**
 * Attachments are out of SUPPORT-1 scope.
 * A later attachment path must reuse private receipt storage, not a public upload folder.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SupportRequestEntity,
      SupportMessageEntity,
      OrderEntity,
    ]),
    ManualPaymentModule,
  ],
  controllers: [SupportController],
  providers: [SupportService, PermissionsGuard],
})
export class SupportModule {}
