import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  MarketplaceConfigError,
  parsePositiveIntConfig,
} from './marketplace-config.util';

export const MARKETPLACE_IMPORT_CONCURRENCY_OPTIONS =
  'MARKETPLACE_IMPORT_CONCURRENCY_OPTIONS';

export class MarketplaceImportQueueFullError extends Error {
  constructor() {
    super('Marketplace import queue is full');
    this.name = 'MarketplaceImportQueueFullError';
  }
}

export class MarketplaceImportQueueTimeoutError extends Error {
  constructor() {
    super('Marketplace import queue wait timed out');
    this.name = 'MarketplaceImportQueueTimeoutError';
  }
}

interface QueueWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  cancelled: boolean;
}

export interface ConcurrencyPermit {
  release: () => void;
}

@Injectable()
export class MarketplaceImportConcurrencyGate {
  private active = 0;
  private readonly queue: QueueWaiter[] = [];
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private readonly queueTimeoutMs: number;

  constructor(
    @Optional()
    @Inject(MARKETPLACE_IMPORT_CONCURRENCY_OPTIONS)
    config?: {
      maxConcurrent?: number;
      maxQueue?: number;
      queueTimeoutMs?: number;
    },
  ) {
    try {
      this.maxConcurrent = parsePositiveIntConfig(
        config?.maxConcurrent ?? process.env.MARKETPLACE_IMPORT_MAX_CONCURRENT,
        3,
        1,
        50,
        'MARKETPLACE_IMPORT_MAX_CONCURRENT',
      );
      this.maxQueue = parsePositiveIntConfig(
        config?.maxQueue ?? process.env.MARKETPLACE_IMPORT_MAX_QUEUE,
        20,
        1,
        500,
        'MARKETPLACE_IMPORT_MAX_QUEUE',
      );
      this.queueTimeoutMs = parsePositiveIntConfig(
        config?.queueTimeoutMs ??
          process.env.MARKETPLACE_IMPORT_QUEUE_TIMEOUT_MS,
        30000,
        1000,
        300000,
        'MARKETPLACE_IMPORT_QUEUE_TIMEOUT_MS',
      );
    } catch (error) {
      if (config) {
        throw error;
      }
      throw new MarketplaceConfigError(
        `Invalid marketplace concurrency configuration: ${error.message}`,
      );
    }
  }

  async acquire(): Promise<ConcurrencyPermit> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return this.createPermit();
    }

    if (this.queue.length >= this.maxQueue) {
      throw new MarketplaceImportQueueFullError();
    }

    await new Promise<void>((resolve, reject) => {
      const waiter: QueueWaiter = {
        resolve: () => {
          if (waiter.cancelled) {
            return;
          }
          this.active += 1;
          resolve();
        },
        reject,
        cancelled: false,
        timeoutId: setTimeout(() => {
          waiter.cancelled = true;
          const index = this.queue.indexOf(waiter);
          if (index >= 0) {
            this.queue.splice(index, 1);
          }
          reject(new MarketplaceImportQueueTimeoutError());
        }, this.queueTimeoutMs),
      };

      this.queue.push(waiter);
    });

    return this.createPermit();
  }

  private createPermit(): ConcurrencyPermit {
    let released = false;
    return {
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.active = Math.max(0, this.active - 1);
        this.drainQueue();
      },
    };
  }

  private drainQueue(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next || next.cancelled) {
        continue;
      }
      clearTimeout(next.timeoutId);
      next.resolve();
      return;
    }
  }

  getActiveCount(): number {
    return this.active;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  reset(): void {
    while (this.queue.length > 0) {
      const waiter = this.queue.shift();
      if (!waiter) {
        continue;
      }
      waiter.cancelled = true;
      clearTimeout(waiter.timeoutId);
      waiter.reject(new MarketplaceImportQueueTimeoutError());
    }
    this.active = 0;
  }
}
