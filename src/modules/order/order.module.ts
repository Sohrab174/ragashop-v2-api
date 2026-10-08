import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductModule } from '../product/product.module';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderEntity } from './entities/order.entity';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { MailModule } from '../../mail/mail.module';
import { CustomerModule } from '../customer/customer.module';
import { OrderStatusEntity } from './entities/order-status.entity';
import { AddressModule } from '../address/address.module';
import { SettingModule } from '../setting/setting.module';
import { TelegrafBotModule } from '../../thirdParty/telegraf/telegraf-bot.module';
import { OrderPaymentFinalizationEntity } from './entities/order-payment-finalization.entity';
import { ReferralAwardEntity } from '../customer/entities/referral-award.entity';
import { FinanceModule } from '../finance/finance.module';
import { ManualPaymentModule } from '../manual-payment/manual-payment.module';
import { PaymentSubmissionEntity } from '../manual-payment/entities/payment-submission.entity';
import { SupportRequestEntity } from '../support/entities/support-request.entity';
import { OperationsDashboardService } from './operations-dashboard.service';
import { CapabilityModule } from '../auth/capability/capability.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderEntity,
      OrderItemEntity,
      OrderStatusEntity,
      ReferralAwardEntity,
      OrderPaymentFinalizationEntity,
      PaymentSubmissionEntity,
      SupportRequestEntity,
    ]),
    ProductModule,
    MailModule,
    CustomerModule,
    AddressModule,
    SettingModule,
    TelegrafBotModule,
    FinanceModule,
    forwardRef(() => ManualPaymentModule),
    CapabilityModule,
  ],
  controllers: [OrderController],
  providers: [OrderService, OperationsDashboardService],
  exports: [OrderService],
})
export class OrderModule {}
