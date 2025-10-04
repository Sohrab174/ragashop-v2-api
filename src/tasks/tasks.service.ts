import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as dotenv from 'dotenv';
import { OrderService } from '../modules/order/order.service';
import { SettingService } from '../modules/setting/setting.service';
import { ProductService } from '../modules/product/product.service';
dotenv.config();

@Injectable()
export class TasksService {
  constructor(
    private orderService: OrderService,
    private settingService: SettingService,
    private productService: ProductService,
  ) {}

  @Cron(process.env.CRON_JOB_DELETE_UNPAID_ORDER)
  async handleDeleteUnpaidOrder() {
    console.log('CRON JOB FOR DELETE UNPAID ORDER');
    await this.orderService.handleDeleteUnpaid();
  }

  // @Cron(process.env.CRON_JOB_CRAWLER_PRODUCT_DETAILS)
  // async handleCrawlerProductDetails() {
  //   console.log('CRON JOB FOR CRAWLER PRODUCT DETAILS');
  //   await this.productService.getProductsDetailsByCrawler();
  // }

  // @Cron(process.env.CRON_JOB_CRAWLER_PRODUCT_PAGES)
  // async handleProductsPagesByCrawler() {
  //   console.log('CRON JOB FOR CRAWLER PRODUCT PAGES');
  //   await this.productService.getProductsPagesByCrawler();
  // }

  // @Cron(process.env.CRON_JOB_TRY_TO_RIAL)
  // async handleTryToRial() {
  //   console.log('CRON JOB FOR GET TRY TO RIAL');
  //   await this.settingService.getTryToRial();
  // }
}
