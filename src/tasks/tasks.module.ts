import { Module, forwardRef } from '@nestjs/common';
import { OrderModule } from '../modules/order/order.module';
import { TasksService } from './tasks.service';
import { SettingModule } from '../modules/setting/setting.module';
import { ProductModule } from '../modules/product/product.module';
import { ManualPaymentModule } from '../modules/manual-payment/manual-payment.module';

@Module({
  imports: [
    OrderModule,
    SettingModule,
    ProductModule,
    forwardRef(() => ManualPaymentModule),
  ],
  providers: [TasksService],
})
export class TasksModule {}
