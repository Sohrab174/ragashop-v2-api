import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as dotenv from 'dotenv';
import { OrderService } from '../modules/order/order.service';
import { SettingService } from '../modules/setting/setting.service';
import { ProductService } from '../modules/product/product.service';
import { PaymentSubmissionService } from '../modules/manual-payment/payment-submission.service';
import { loadUnpaidOrderCleanupConfig } from '../modules/order/utils/unpaid-order-cleanup.config';
dotenv.config();

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private orderService: OrderService,
    private settingService: SettingService,
    private productService: ProductService,
    private paymentSubmissionService: PaymentSubmissionService,
  ) {}

  /**
   * Phase C1: unpaid pending cleanup. Schedule expression comes from ENV;
   * actual work is gated by UNPAID_ORDER_CLEANUP_ENABLED (default false).
   */
  @Cron(process.env.CRON_JOB_DELETE_UNPAID_ORDER || '0 0 * * *')
  async handleDeleteUnpaidOrder() {
    const config = loadUnpaidOrderCleanupConfig();
    if (!config.enabled) {
      return;
    }

    this.logger.log(
      `Unpaid order cleanup starting (timeoutHours=${config.timeoutHours}, batchSize=${config.batchSize})`,
    );
    const result = await this.orderService.handleDeleteUnpaid();
    this.logger.log(
      `Unpaid order cleanup finished processed=${result.processed} released=${result.released} failed=${result.failed}`,
    );
  }

  /**
   * C2A: expire SUBMITTED/UNDER_REVIEW holds past holdExpiresAt.
   * Gated by MANUAL_PAYMENT_HOLD_EXPIRE_ENABLED (default true unless 'false').
   * Batch size from MANUAL_PAYMENT_HOLD_EXPIRE_BATCH_SIZE (default 100).
   */
  @Cron(process.env.CRON_JOB_EXPIRE_MANUAL_PAYMENT_HOLDS || '*/10 * * * *')
  async handleExpireManualPaymentHolds() {
    if (process.env.MANUAL_PAYMENT_HOLD_EXPIRE_ENABLED === 'false') {
      return;
    }
    const rawBatch = Number(process.env.MANUAL_PAYMENT_HOLD_EXPIRE_BATCH_SIZE);
    const batchSize =
      Number.isFinite(rawBatch) && rawBatch > 0
        ? Math.min(Math.floor(rawBatch), 500)
        : 100;

    this.logger.log(
      `Manual payment hold expire starting (batchSize=${batchSize})`,
    );
    const count = await this.paymentSubmissionService.expireHoldsBatch(
      batchSize,
    );
    this.logger.log(`Manual payment hold expire finished expired=${count}`);
  }

  // Local isolation: production cron jobs that mutate data or call
  // live FX/crawler endpoints remain disabled in this workspace.
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

  /**
   * F1: refresh TGJU TRY rate ~every 5 minutes.
   * Gated by FX_RATE_REFRESH_ENABLED (default true in production-like envs;
   * set false for local isolation). Never overwrites last-known-good with null.
   */
  @Cron(process.env.CRON_JOB_TRY_TO_RIAL || '*/5 * * * *')
  async handleTryToRial() {
    if (process.env.FX_RATE_REFRESH_ENABLED === 'false') {
      return;
    }
    this.logger.log('TGJU TRY rate refresh starting');
    const result = await this.settingService.getTryToRial();
    if (result == null) {
      this.logger.warn('TGJU TRY rate refresh failed; last-known-good retained');
      return;
    }
    this.logger.log(`TGJU TRY rate refresh ok value=${result}`);
  }
}
