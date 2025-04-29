import { Module } from '@nestjs/common';
import { OrderModule } from '../modules/order/order.module';
import { TasksService } from './tasks.service';
import { SettingModule } from '../modules/setting/setting.module';
import { ProductModule } from '../modules/product/product.module';

@Module({
  imports: [OrderModule, SettingModule, ProductModule],
  providers: [TasksService],
})
export class TasksModule {}
