import { validateTrustProxyRuntimeConfig } from './trust-proxy.util';
import { validateMarketplaceImportJobRuntimeConfig } from './marketplace-import-job.config';
import { validateCatalogLifecycleRuntimeConfig } from '../catalog-lifecycle/catalog-lifecycle.config';

export class MarketplaceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketplaceConfigError';
  }
}

export function parsePositiveIntConfig(
  raw: string | number | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const value =
    raw == null || raw === ''
      ? fallback
      : typeof raw === 'number'
      ? raw
      : Number(raw);
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new MarketplaceConfigError(
      `${name} must be an integer between ${min} and ${max}`,
    );
  }
  return value;
}

export function requireCrawlerInternalSecret(): string {
  const secret = (process.env.CRAWLER_INTERNAL_SECRET || '').trim();
  if (!secret) {
    throw new MarketplaceConfigError(
      'CRAWLER_INTERNAL_SECRET is required for crawler communication',
    );
  }
  return secret;
}

export async function validateMarketplaceImportRuntimeConfig(): Promise<void> {
  // ONLY NODE_ENV=test may skip — JEST_WORKER_ID is not an authority.
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  requireCrawlerInternalSecret();
  validateTrustProxyRuntimeConfig();
  parsePositiveIntConfig(
    process.env.MARKETPLACE_IMPORT_RATE_LIMIT_WINDOW_MS,
    60000,
    1000,
    3600000,
    'MARKETPLACE_IMPORT_RATE_LIMIT_WINDOW_MS',
  );
  parsePositiveIntConfig(
    process.env.MARKETPLACE_IMPORT_RATE_LIMIT_MAX,
    10,
    1,
    1000,
    'MARKETPLACE_IMPORT_RATE_LIMIT_MAX',
  );
  parsePositiveIntConfig(
    process.env.MARKETPLACE_IMPORT_MAX_CONCURRENT,
    3,
    1,
    50,
    'MARKETPLACE_IMPORT_MAX_CONCURRENT',
  );
  parsePositiveIntConfig(
    process.env.MARKETPLACE_IMPORT_MAX_QUEUE,
    20,
    1,
    500,
    'MARKETPLACE_IMPORT_MAX_QUEUE',
  );
  parsePositiveIntConfig(
    process.env.MARKETPLACE_IMPORT_QUEUE_TIMEOUT_MS,
    30000,
    1000,
    300000,
    'MARKETPLACE_IMPORT_QUEUE_TIMEOUT_MS',
  );
  parsePositiveIntConfig(
    process.env.MARKETPLACE_REDIRECT_MAX_HOPS,
    10,
    1,
    20,
    'MARKETPLACE_REDIRECT_MAX_HOPS',
  );
  parsePositiveIntConfig(
    process.env.MARKETPLACE_REDIRECT_TIMEOUT_MS,
    10000,
    1000,
    60000,
    'MARKETPLACE_REDIRECT_TIMEOUT_MS',
  );
  parsePositiveIntConfig(
    process.env.MARKETPLACE_REDIRECT_TOTAL_TIMEOUT_MS,
    15000,
    1000,
    120000,
    'MARKETPLACE_REDIRECT_TOTAL_TIMEOUT_MS',
  );
  await validateMarketplaceImportJobRuntimeConfig();
  validateCatalogLifecycleRuntimeConfig();
  parsePositiveIntConfig(
    process.env.HIGH_INTENT_FRESHNESS_TTL_MS,
    24 * 60 * 60 * 1000,
    60 * 1000,
    90 * 24 * 60 * 60 * 1000,
    'HIGH_INTENT_FRESHNESS_TTL_MS',
  );
}
