export declare class MarketplaceIdentityLeaseConfigError extends Error {
  constructor(message: string);
}

export declare const MARKETPLACE_IDENTITY_LEASE_DEFAULT_MS: number;
export declare const MARKETPLACE_IDENTITY_LEASE_MIN_MS: number;
export declare const MARKETPLACE_IDENTITY_LEASE_MAX_MS: number;
export declare const DEFAULT_CRAWLER_BASE_URL: string;

export declare function parseMarketplaceIdentityLeaseMs(
  raw: string | number | null | undefined,
  fallback?: number,
): number;

export declare function loadMarketplaceIdentityLeaseMsFromEnv(
  env?: NodeJS.ProcessEnv,
): number;

export declare function resolveImportInProgressSoftWindowMs(options: {
  crawlerIdentityLeaseMs: number;
  softWindowRaw?: string | number | null;
}): number;

export declare function getEffectiveCrawlerBaseUrl(
  env?: NodeJS.ProcessEnv,
): string;

export declare function assertCrawlerLeaseSkipAllowed(
  env?: NodeJS.ProcessEnv,
): boolean;
