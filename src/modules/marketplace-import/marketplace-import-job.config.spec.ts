import { MarketplaceConfigError } from './marketplace-config.util';
import {
  assertMarketplaceImportJobRetryBounds,
  assertSoftWindowCoversCrawlerLease,
  getEffectiveCrawlerBaseUrl,
  loadImportInProgressSoftWindowMs,
  loadMarketplaceIdentityLeaseMs,
  loadMarketplaceImportJobRuntimeConfig,
  validateMarketplaceImportCrossProcessLease,
  validateMarketplaceImportJobRuntimeConfig,
} from './marketplace-import-job.config';
import {
  assertCrawlerLeaseSkipAllowed,
  DEFAULT_CRAWLER_BASE_URL,
} from '@ragashop/marketplace-identity-lease';
describe('MarketplaceImportJobConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('loads safe defaults', () => {
    delete process.env.MARKETPLACE_JOB_MAX_ATTEMPTS;
    const config = loadMarketplaceImportJobRuntimeConfig();
    expect(config.maxAttempts).toBe(3);
    expect(config.leaseMs).toBe(300000);
  });

  it('rejects invalid max attempts', () => {
    process.env.MARKETPLACE_JOB_MAX_ATTEMPTS = '0';
    expect(() => loadMarketplaceImportJobRuntimeConfig()).toThrow(
      MarketplaceConfigError,
    );
  });

  it('rejects retry base greater than max', () => {
    expect(() =>
      assertMarketplaceImportJobRetryBounds({
        maxAttempts: 3,
        leaseMs: 300000,
        retryBaseMs: 200000,
        retryMaxMs: 10000,
        pollIntervalMs: 2000,
        workerEnabled: true,
      }),
    ).toThrow();
  });

  it('derives soft retry window from identity lease by default', () => {
    expect(loadMarketplaceIdentityLeaseMs({})).toBe(600_000);
    expect(loadImportInProgressSoftWindowMs({})).toBe(600_000);
  });

  it('allows soft window longer than identity lease', () => {
    expect(
      loadImportInProgressSoftWindowMs({
        MARKETPLACE_IDENTITY_LEASE_MS: '600000',
        MARKETPLACE_IMPORT_IN_PROGRESS_SOFT_WINDOW_MS: '900000',
      }),
    ).toBe(900_000);
  });

  it('rejects soft window shorter than identity lease', () => {
    expect(() =>
      loadImportInProgressSoftWindowMs({
        MARKETPLACE_IDENTITY_LEASE_MS: '900000',
        MARKETPLACE_IMPORT_IN_PROGRESS_SOFT_WINDOW_MS: '600000',
      }),
    ).toThrow(MarketplaceConfigError);
  });

  it('fails when soft window is below authoritative crawler lease', () => {
    expect(() => assertSoftWindowCoversCrawlerLease(600_000, 900_000)).toThrow(
      MarketplaceConfigError,
    );
  });

  it('cross-process contract: soft window must cover remote crawler lease', () => {
    const crawlerLeaseMs = 900_000;
    const soft = loadImportInProgressSoftWindowMs(
      {
        MARKETPLACE_IMPORT_IN_PROGRESS_SOFT_WINDOW_MS: '900000',
      },
      crawlerLeaseMs,
    );
    expect(soft).toBe(900_000);
    expect(() =>
      loadImportInProgressSoftWindowMs(
        { MARKETPLACE_IMPORT_IN_PROGRESS_SOFT_WINDOW_MS: '600000' },
        crawlerLeaseMs,
      ),
    ).toThrow(MarketplaceConfigError);
  });

  it('effective crawler URL uses runtime default when CRAWLER_BASE_URL omitted', () => {
    expect(getEffectiveCrawlerBaseUrl({})).toBe(DEFAULT_CRAWLER_BASE_URL);
    expect(
      getEffectiveCrawlerBaseUrl({ CRAWLER_BASE_URL: 'http://crawler:9020' }),
    ).toBe('http://crawler:9020');
  });

  it('mismatch fails even when CRAWLER_BASE_URL env is omitted (uses effective default)', async () => {
    const fetchLease = jest.fn().mockResolvedValue(900_000);
    await expect(
      validateMarketplaceImportCrossProcessLease(
        {
          MARKETPLACE_IMPORT_IN_PROGRESS_SOFT_WINDOW_MS: '600000',
        } as NodeJS.ProcessEnv,
        fetchLease,
      ),
    ).rejects.toThrow(MarketplaceConfigError);
    expect(fetchLease).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: DEFAULT_CRAWLER_BASE_URL }),
    );
  });

  it('startup validation fails on crawler fetch failure', async () => {
    await expect(
      validateMarketplaceImportCrossProcessLease(
        {} as NodeJS.ProcessEnv,
        async () => {
          throw new Error('ECONNREFUSED');
        },
      ),
    ).rejects.toThrow(/Failed to validate crawler identity lease/);
  });

  it('skip mode allowed only when NODE_ENV=test', () => {
    expect(
      assertCrawlerLeaseSkipAllowed({
        NODE_ENV: 'test',
        MARKETPLACE_SKIP_CRAWLER_LEASE_CHECK: '1',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it('skip mode fails in production', () => {
    expect(() =>
      assertCrawlerLeaseSkipAllowed({
        NODE_ENV: 'production',
        MARKETPLACE_SKIP_CRAWLER_LEASE_CHECK: '1',
      } as NodeJS.ProcessEnv),
    ).toThrow(/NODE_ENV=test/);
  });

  it('skip mode fails in production even with RAGASHOP_ALLOW_TEST_LEASE_SKIP', () => {
    expect(() =>
      assertCrawlerLeaseSkipAllowed({
        NODE_ENV: 'production',
        RAGASHOP_ALLOW_TEST_LEASE_SKIP: '1',
        MARKETPLACE_SKIP_CRAWLER_LEASE_CHECK: '1',
      } as NodeJS.ProcessEnv),
    ).toThrow(/NODE_ENV=test/);
  });

  it('skip mode fails in development', () => {
    expect(() =>
      assertCrawlerLeaseSkipAllowed({
        NODE_ENV: 'development',
        MARKETPLACE_SKIP_CRAWLER_LEASE_CHECK: '1',
      } as NodeJS.ProcessEnv),
    ).toThrow(/NODE_ENV=test/);
  });

  it('skip mode fails when NODE_ENV is missing', () => {
    expect(() =>
      assertCrawlerLeaseSkipAllowed({
        MARKETPLACE_SKIP_CRAWLER_LEASE_CHECK: '1',
      } as NodeJS.ProcessEnv),
    ).toThrow(/NODE_ENV=test/);
  });

  it('production without skip still requires crawler lease validation', async () => {
    const fetchLease = jest.fn().mockResolvedValue(600_000);
    await validateMarketplaceImportCrossProcessLease(
      {
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv,
      fetchLease,
    );
    expect(fetchLease).toHaveBeenCalled();
  });

  it('1) production + JEST_WORKER_ID + skip → rejected', () => {
    expect(() =>
      assertCrawlerLeaseSkipAllowed({
        NODE_ENV: 'production',
        JEST_WORKER_ID: '1',
        MARKETPLACE_SKIP_CRAWLER_LEASE_CHECK: '1',
      } as NodeJS.ProcessEnv),
    ).toThrow(/NODE_ENV=test/);
  });

  it('2) production + JEST_WORKER_ID + lease mismatch → validation runs and fails', async () => {
    const fetchLease = jest.fn().mockResolvedValue(900_000);
    await expect(
      validateMarketplaceImportCrossProcessLease(
        {
          NODE_ENV: 'production',
          JEST_WORKER_ID: '1',
          MARKETPLACE_IMPORT_IN_PROGRESS_SOFT_WINDOW_MS: '600000',
        } as NodeJS.ProcessEnv,
        fetchLease,
      ),
    ).rejects.toThrow(MarketplaceConfigError);
    expect(fetchLease).toHaveBeenCalled();
  });

  it('3) test + JEST_WORKER_ID + skip → allowed', () => {
    expect(
      assertCrawlerLeaseSkipAllowed({
        NODE_ENV: 'test',
        JEST_WORKER_ID: '1',
        MARKETPLACE_SKIP_CRAWLER_LEASE_CHECK: '1',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it('4) development + JEST_WORKER_ID + skip → rejected', () => {
    expect(() =>
      assertCrawlerLeaseSkipAllowed({
        NODE_ENV: 'development',
        JEST_WORKER_ID: '1',
        MARKETPLACE_SKIP_CRAWLER_LEASE_CHECK: '1',
      } as NodeJS.ProcessEnv),
    ).toThrow(/NODE_ENV=test/);
  });

  it('5) unset NODE_ENV + JEST_WORKER_ID + skip → rejected', () => {
    expect(() =>
      assertCrawlerLeaseSkipAllowed({
        JEST_WORKER_ID: '1',
        MARKETPLACE_SKIP_CRAWLER_LEASE_CHECK: '1',
      } as NodeJS.ProcessEnv),
    ).toThrow(/NODE_ENV=test/);
  });

  it('startup validateMarketplaceImportJobRuntimeConfig ignores JEST_WORKER_ID', async () => {
    const originalEnv = { ...process.env };
    try {
      process.env.NODE_ENV = 'production';
      process.env.JEST_WORKER_ID = '1';
      delete process.env.MARKETPLACE_SKIP_CRAWLER_LEASE_CHECK;
      process.env.MARKETPLACE_IMPORT_IN_PROGRESS_SOFT_WINDOW_MS = '600000';
      // Will attempt crawler fetch / lease check — must NOT early-return on JEST_WORKER_ID.
      await expect(
        validateMarketplaceImportJobRuntimeConfig(),
      ).rejects.toThrow();
    } finally {
      process.env = { ...originalEnv };
    }
  });
});
