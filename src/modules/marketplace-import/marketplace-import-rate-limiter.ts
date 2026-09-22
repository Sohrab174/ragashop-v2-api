import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  MarketplaceConfigError,
  parsePositiveIntConfig,
} from './marketplace-config.util';

export const MARKETPLACE_IMPORT_RATE_LIMITER_OPTIONS =
  'MARKETPLACE_IMPORT_RATE_LIMITER_OPTIONS';

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  maxKeys: number;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
  lastSeen: number;
}

@Injectable()
export class MarketplaceImportRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(
    @Optional()
    @Inject(MARKETPLACE_IMPORT_RATE_LIMITER_OPTIONS)
    config?: Partial<RateLimitConfig> & { now?: () => number },
  ) {
    try {
      this.windowMs = parsePositiveIntConfig(
        config?.windowMs ?? process.env.MARKETPLACE_IMPORT_RATE_LIMIT_WINDOW_MS,
        60000,
        1000,
        3600000,
        'MARKETPLACE_IMPORT_RATE_LIMIT_WINDOW_MS',
      );
      this.maxRequests = parsePositiveIntConfig(
        config?.maxRequests ?? process.env.MARKETPLACE_IMPORT_RATE_LIMIT_MAX,
        10,
        1,
        1000,
        'MARKETPLACE_IMPORT_RATE_LIMIT_MAX',
      );
      this.maxKeys = parsePositiveIntConfig(
        config?.maxKeys ?? process.env.MARKETPLACE_IMPORT_RATE_LIMIT_MAX_KEYS,
        10000,
        100,
        100000,
        'MARKETPLACE_IMPORT_RATE_LIMIT_MAX_KEYS',
      );
    } catch (error) {
      if (config) {
        throw error;
      }
      throw new MarketplaceConfigError(
        `Invalid marketplace rate-limit configuration: ${error.message}`,
      );
    }

    this.now = config?.now ?? (() => Date.now());
  }

  isAllowed(clientKey: string): boolean {
    const key = clientKey || 'unknown';
    const now = this.now();

    this.evictExpired(now);

    const entry = this.entries.get(key);
    if (!entry) {
      this.ensureCapacity(now);
      this.entries.set(key, { count: 1, windowStart: now, lastSeen: now });
      return true;
    }

    entry.lastSeen = now;

    if (now - entry.windowStart >= this.windowMs) {
      entry.count = 1;
      entry.windowStart = now;
      return true;
    }

    if (entry.count >= this.maxRequests) {
      return false;
    }

    entry.count += 1;
    return true;
  }

  private evictExpired(now: number): void {
    for (const [key, entry] of this.entries.entries()) {
      if (now - entry.lastSeen >= this.windowMs * 2) {
        this.entries.delete(key);
      }
    }
  }

  private ensureCapacity(now: number): void {
    if (this.entries.size < this.maxKeys) {
      return;
    }

    let oldestKey: string | null = null;
    let oldestSeen = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.lastSeen < oldestSeen) {
        oldestSeen = entry.lastSeen;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.entries.delete(oldestKey);
      return;
    }

    this.entries.clear();
    this.entries.set('__capacity__', {
      count: this.maxRequests,
      windowStart: now,
      lastSeen: now,
    });
  }

  reset(): void {
    this.entries.clear();
  }

  getEntryCount(): number {
    return this.entries.size;
  }
}
