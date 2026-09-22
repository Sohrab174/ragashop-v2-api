import {
  MarketplaceConfigError,
  parsePositiveIntConfig,
} from './marketplace-config.util';
import {
  assertCrawlerLeaseSkipAllowed,
  getEffectiveCrawlerBaseUrl,
  loadMarketplaceIdentityLeaseMsFromEnv,
  resolveImportInProgressSoftWindowMs,
  MarketplaceIdentityLeaseConfigError,
} from '@ragashop/marketplace-identity-lease';

export interface MarketplaceImportJobRuntimeConfig {
  maxAttempts: number;
  leaseMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  pollIntervalMs: number;
  workerEnabled: boolean;
}

export function loadMarketplaceImportJobRuntimeConfig(): MarketplaceImportJobRuntimeConfig {
  return {
    maxAttempts: parsePositiveIntConfig(
      process.env.MARKETPLACE_JOB_MAX_ATTEMPTS,
      3,
      1,
      10,
      'MARKETPLACE_JOB_MAX_ATTEMPTS',
    ),
    leaseMs: parsePositiveIntConfig(
      process.env.MARKETPLACE_JOB_LEASE_MS,
      300000,
      30000,
      900000,
      'MARKETPLACE_JOB_LEASE_MS',
    ),
    retryBaseMs: parsePositiveIntConfig(
      process.env.MARKETPLACE_JOB_RETRY_BASE_MS,
      5000,
      1000,
      600000,
      'MARKETPLACE_JOB_RETRY_BASE_MS',
    ),
    retryMaxMs: parsePositiveIntConfig(
      process.env.MARKETPLACE_JOB_RETRY_MAX_MS,
      120000,
      1000,
      3600000,
      'MARKETPLACE_JOB_RETRY_MAX_MS',
    ),
    pollIntervalMs: parsePositiveIntConfig(
      process.env.MARKETPLACE_JOB_POLL_INTERVAL_MS,
      2000,
      500,
      60000,
      'MARKETPLACE_JOB_POLL_INTERVAL_MS',
    ),
    workerEnabled: parseBooleanConfig(
      process.env.MARKETPLACE_JOB_WORKER_ENABLED,
      true,
    ),
  };
}

export function loadMarketplaceIdentityLeaseMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  try {
    return loadMarketplaceIdentityLeaseMsFromEnv(env);
  } catch (error) {
    throw new MarketplaceConfigError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Soft window vs an authoritative crawler identity lease (not API's local guess alone).
 */
export function loadImportInProgressSoftWindowMs(
  env: NodeJS.ProcessEnv = process.env,
  crawlerIdentityLeaseMs?: number,
): number {
  const leaseMs = crawlerIdentityLeaseMs ?? loadMarketplaceIdentityLeaseMs(env);
  try {
    return resolveImportInProgressSoftWindowMs({
      crawlerIdentityLeaseMs: leaseMs,
      softWindowRaw: env.MARKETPLACE_IMPORT_IN_PROGRESS_SOFT_WINDOW_MS,
    });
  } catch (error) {
    throw new MarketplaceConfigError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function assertSoftWindowCoversCrawlerLease(
  softWindowMs: number,
  crawlerIdentityLeaseMs: number,
): void {
  if (softWindowMs < crawlerIdentityLeaseMs) {
    throw new MarketplaceConfigError(
      `Import soft window (${softWindowMs}ms) must be >= crawler identity lease (${crawlerIdentityLeaseMs}ms)`,
    );
  }
}

export async function fetchCrawlerIdentityLeaseMs(options: {
  baseUrl: string;
  internalSecret?: string;
  timeoutMs?: number;
}): Promise<number> {
  const axios = (await import('axios')).default;
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (options.internalSecret) {
    headers['x-crawler-secret'] = options.internalSecret;
  }
  const { data } = await axios.get(
    `${options.baseUrl.replace(
      /\/$/,
      '',
    )}/internal/marketplace-identity-config`,
    {
      headers,
      timeout: options.timeoutMs ?? 5000,
    },
  );
  const leaseMs = Number(data?.leaseMs);
  if (!Number.isFinite(leaseMs) || !Number.isInteger(leaseMs)) {
    throw new MarketplaceConfigError(
      'Crawler identity-config response missing integer leaseMs',
    );
  }
  return leaseMs;
}

export function assertMarketplaceImportJobRetryBounds(
  config: MarketplaceImportJobRuntimeConfig,
): void {
  if (config.retryBaseMs > config.retryMaxMs) {
    throw new Error(
      'MARKETPLACE_JOB_RETRY_BASE_MS must be <= MARKETPLACE_JOB_RETRY_MAX_MS',
    );
  }
}

/**
 * Cross-process soft-window vs crawler lease validation against the effective
 * crawler base URL (same default the runtime client uses).
 */
export async function validateMarketplaceImportCrossProcessLease(
  env: NodeJS.ProcessEnv = process.env,
  fetchLease: typeof fetchCrawlerIdentityLeaseMs = fetchCrawlerIdentityLeaseMs,
): Promise<void> {
  try {
    if (assertCrawlerLeaseSkipAllowed(env)) {
      const localLease = loadMarketplaceIdentityLeaseMs(env);
      const softWindow = loadImportInProgressSoftWindowMs(env, localLease);
      assertSoftWindowCoversCrawlerLease(softWindow, localLease);
      return;
    }
  } catch (error) {
    if (
      error instanceof MarketplaceIdentityLeaseConfigError ||
      (error as Error)?.name === 'MarketplaceIdentityLeaseConfigError'
    ) {
      throw new MarketplaceConfigError(
        error instanceof Error ? error.message : String(error),
      );
    }
    throw error;
  }

  const crawlerBaseUrl = getEffectiveCrawlerBaseUrl(env);
  let crawlerLease: number;
  try {
    crawlerLease = await fetchLease({
      baseUrl: crawlerBaseUrl,
      internalSecret: env.CRAWLER_INTERNAL_SECRET,
    });
  } catch (error) {
    if (error instanceof MarketplaceConfigError) {
      throw error;
    }
    throw new MarketplaceConfigError(
      `Failed to validate crawler identity lease at ${crawlerBaseUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const softWindow = loadImportInProgressSoftWindowMs(env, crawlerLease);
  assertSoftWindowCoversCrawlerLease(softWindow, crawlerLease);
}

export async function validateMarketplaceImportJobRuntimeConfig(): Promise<void> {
  // ONLY NODE_ENV=test may skip — JEST_WORKER_ID is not an authority.
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const config = loadMarketplaceImportJobRuntimeConfig();
  assertMarketplaceImportJobRetryBounds(config);
  await validateMarketplaceImportCrossProcessLease();
}

export { getEffectiveCrawlerBaseUrl };

function parseBooleanConfig(
  raw: string | undefined,
  fallback: boolean,
): boolean {
  if (raw == null || raw.trim() === '') {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  throw new Error(`Invalid boolean config value: ${raw}`);
}
