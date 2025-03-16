import { Module } from '@nestjs/common';
import { OrderModule } from '../modules/order/order.module';
import { TasksService } from './tasks.service';
import { SettingModule } from '../modules/setting/setting.module';

@Module({
  imports: [OrderModule, SettingModule],
  providers: [TasksService],
})
export class TasksModule {}
