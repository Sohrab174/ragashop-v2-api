import { Module } from '@nestjs/common';
import { OrderModule } from '../modules/order/order.module';
import { TasksService } from './tasks.service';

@Module({
  imports: [OrderModule],
  providers: [TasksService],
})
export class TasksModule {}
