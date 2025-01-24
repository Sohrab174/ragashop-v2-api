import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as dotenv from 'dotenv';
import { OrderService } from '../modules/order/order.service';
dotenv.config();

@Injectable()
export class TasksService {
  constructor(private orderService: OrderService) {}

  // @Cron(process.env.CRON_JOB_DELETE_UNPAID_ORDER)
  // async handleDeleteUnpaidOrder() {
  //   console.log('CRON JOB FOR DELETE UNPAID ORDER');
  //   await this.orderService.handleDeleteUnpaid();
  // }
}
