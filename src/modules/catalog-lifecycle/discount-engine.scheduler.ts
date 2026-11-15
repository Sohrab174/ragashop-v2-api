import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DiscountEngineService } from './discount-engine.service';
import { isDiscountEngineLiveEnabled } from './discount-engine.config';

/**
 * Optional daily discount engine schedule.
 * Disabled unless DISCOUNT_ENGINE_CRON_ENABLED=true AND live flag is set.
 * Overlap protection via in-process running lock.
 */
@Injectable()
export class DiscountEngineScheduler {
  private readonly logger = new Logger(DiscountEngineScheduler.name);
  private running = false;
  private lastStartedAt: string | null = null;
  private lastFinishedAt: string | null = null;
  private lastStatus: 'idle' | 'running' | 'ok' | 'skipped' | 'error' = 'idle';
  private lastError: string | null = null;

  constructor(private readonly engine: DiscountEngineService) {}

  /**
   * Default: 03:15 server local time daily.
   * Override with DISCOUNT_ENGINE_CRON (standard cron expression).
   */
  @Cron(process.env.DISCOUNT_ENGINE_CRON || '15 3 * * *')
  async handleDailyCron() {
    if (String(process.env.DISCOUNT_ENGINE_CRON_ENABLED || '').trim() !== 'true') {
      return;
    }
    if (!isDiscountEngineLiveEnabled()) {
      this.lastStatus = 'skipped';
      this.logger.warn(
        'Discount engine cron skipped: DISCOUNT_ENGINE_LIVE_ENABLED is not true',
      );
      return;
    }
    if (this.running) {
      this.lastStatus = 'skipped';
      this.logger.warn('Discount engine cron skipped: previous run still active');
      return;
    }

    this.running = true;
    this.lastStatus = 'running';
    this.lastStartedAt = new Date().toISOString();
    this.lastError = null;
    try {
      const report = await this.engine.execute({ mode: 'live' });
      this.lastStatus = 'ok';
      this.logger.log(
        JSON.stringify({
          event: 'discount_engine_cron_complete',
          poolActive: (report as any)?.pool?.activeAfter,
          pdpAttempted: (report as any)?.verification?.attempted,
        }),
      );
    } catch (error) {
      this.lastStatus = 'error';
      this.lastError = (error as Error)?.message || 'unknown';
      this.logger.error(`Discount engine cron failed: ${this.lastError}`);
    } finally {
      this.running = false;
      this.lastFinishedAt = new Date().toISOString();
    }
  }

  getStatus() {
    return {
      enabled:
        String(process.env.DISCOUNT_ENGINE_CRON_ENABLED || '').trim() === 'true',
      cron: process.env.DISCOUNT_ENGINE_CRON || '15 3 * * *',
      running: this.running,
      lastStatus: this.lastStatus,
      lastStartedAt: this.lastStartedAt,
      lastFinishedAt: this.lastFinishedAt,
      lastError: this.lastError,
    };
  }
}
