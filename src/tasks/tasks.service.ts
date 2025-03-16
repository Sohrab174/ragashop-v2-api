import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as dotenv from 'dotenv';
import { OrderService } from '../modules/order/order.service';
import { SettingService } from '../modules/setting/setting.service';
dotenv.config();

@Injectable()
export class TasksService {
  constructor(
    private orderService: OrderService,
    private settingService: SettingService,
  ) {}

  // @Cron(process.env.CRON_JOB_DELETE_UNPAID_ORDER)
  // async handleDeleteUnpaidOrder() {
  //   console.log('CRON JOB FOR DELETE UNPAID ORDER');
  //   await this.orderService.handleDeleteUnpaid();
  // }

  @Cron(process.env.CRON_JOB_TRY_TO_RIAL)
  async handleDeleteUnpaidOrder() {
    console.log('CRON JOB FOR GET TRY TO RIAL');
    await this.settingService.getTryToRial();
  }
}
