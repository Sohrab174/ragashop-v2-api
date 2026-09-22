/**
 * Bounded in-memory sliding-window counter.
 *
 * Launch note: this is process-local (not Redis-backed). It is effective for a
 * single API instance. Multi-instance deployments must terminate TLS/proxy
 * consistently and preferably place an edge rate limiter, or later share state.
 */
export interface SlidingWindowRateLimitConfig {
  windowMs: number;
  maxRequests: number;
  maxKeys: number;
  now?: () => number;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
  lastSeen: number;
}

export class SlidingWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(config: SlidingWindowRateLimitConfig) {
    this.windowMs = config.windowMs;
    this.maxRequests = config.maxRequests;
    this.maxKeys = config.maxKeys;
    this.now = config.now ?? (() => Date.now());
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

  reset(): void {
    this.entries.clear();
  }

  getEntryCount(): number {
    return this.entries.size;
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
}
