import { MarketplaceImportRateLimiter } from './marketplace-import-rate-limiter';
import { MarketplaceConfigError } from './marketplace-config.util';

describe('MarketplaceImportRateLimiter', () => {
  it('allows requests within limit', () => {
    const limiter = new MarketplaceImportRateLimiter({
      windowMs: 60000,
      maxRequests: 3,
      maxKeys: 100,
      now: () => 1000,
    });

    expect(limiter.isAllowed('1.2.3.4')).toBe(true);
    expect(limiter.isAllowed('1.2.3.4')).toBe(true);
    expect(limiter.isAllowed('1.2.3.4')).toBe(true);
    expect(limiter.isAllowed('1.2.3.4')).toBe(false);
  });

  it('evicts expired entries independently', () => {
    let now = 1000;
    const limiter = new MarketplaceImportRateLimiter({
      windowMs: 1000,
      maxRequests: 1,
      maxKeys: 100,
      now: () => now,
    });

    expect(limiter.isAllowed('ip-a')).toBe(true);
    expect(limiter.isAllowed('ip-a')).toBe(false);

    now += 2001;
    expect(limiter.isAllowed('ip-a')).toBe(true);
  });

  it('bounds stored identities', () => {
    const limiter = new MarketplaceImportRateLimiter({
      windowMs: 60000,
      maxRequests: 100,
      maxKeys: 100,
      now: () => 1000,
    });

    for (let i = 0; i < 101; i += 1) {
      expect(limiter.isAllowed(`ip-${i}`)).toBe(true);
    }

    expect(limiter.getEntryCount()).toBeLessThanOrEqual(100);
  });

  it('rejects invalid zero config', () => {
    expect(
      () =>
        new MarketplaceImportRateLimiter({
          windowMs: 1000,
          maxRequests: 0,
          maxKeys: 100,
        }),
    ).toThrow(MarketplaceConfigError);
  });

  it('rejects negative config', () => {
    expect(
      () =>
        new MarketplaceImportRateLimiter({
          windowMs: 1000,
          maxRequests: -1,
          maxKeys: 100,
        }),
    ).toThrow(MarketplaceConfigError);
  });
});
