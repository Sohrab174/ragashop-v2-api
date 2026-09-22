import { parsePositiveIntConfig } from '../marketplace-import/marketplace-config.util';

export interface CatalogLifecycleRuntimeConfig {
  /** Soft target for curated external discovery pool size (policy, not hard delete). */
  externalCatalogTargetSize: number;
  /** Hard ceiling used by capacity planning / future intake. */
  externalCatalogMaxSize: number;
  /** Absolute max products selected or enqueued in one operator run (default 50; env may raise up to 500). */
  hardMaxItemsPerRun: number;
  /** Default batch size when operator omits maxItems. */
  defaultBatchSize: number;
  /** Global kill switch for LIVE catalog refresh enqueue (dry-run always allowed). */
  liveEnqueueEnabled: boolean;
  /** Background catalog refresh paused (circuit / operator). */
  backgroundPaused: boolean;
  /** Per-source max concurrent catalog refresh jobs conceptually reserved. */
  maxConcurrencyPerSource: number;
  /**
   * Legacy/mid cadence env key retained for compatibility.
   * Operational available cadences are HOT / WARM / COLD (see those fields).
   * Ordinary non-discount, non-demand available products use coldFreshnessTtlMs.
   */
  availableFreshnessTtlMs: number;
  /** HOT tier: currently discounted curated products (ms). Default 2d. */
  hotDiscountFreshnessTtlMs: number;
  /** WARM tier: recent cart-demand products without requiring discount (ms). Default 3d. */
  warmDemandFreshnessTtlMs: number;
  /** COLD tier: ordinary curated products without discount/demand (ms). Default 14d. */
  coldFreshnessTtlMs: number;
  /** How far back cart_item.updatedAt counts as demand (ms). */
  cartDemandLookbackMs: number;
  /** Absolute max candidates loaded into memory per scheduler cycle. */
  maxCandidateWindow: number;
  /** Confirmed unavailable recheck interval (ms). */
  oosRecheckIntervalMs: number;
  /** Minimum gap after source_error before re-attempt (ms). */
  sourceErrorCooldownMs: number;
  /** Circuit breaker: failures in window to open. */
  circuitFailureThreshold: number;
  /** Circuit breaker observation window (ms). */
  circuitWindowMs: number;
  /** Circuit open cooldown (ms). */
  circuitCooldownMs: number;
  /** Max samples included in dry-run reason list. */
  dryRunSampleSize: number;
}

function parseBooleanConfig(
  raw: string | undefined,
  fallback: boolean,
): boolean {
  if (raw == null || raw.trim() === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  throw new Error(`Invalid boolean config value: ${raw}`);
}

/**
 * Centralized catalog lifecycle policy (env-backed).
 * Defaults are conservative: live enqueue OFF; small hard max.
 */
export function loadCatalogLifecycleRuntimeConfig(): CatalogLifecycleRuntimeConfig {
  return {
    externalCatalogTargetSize: parsePositiveIntConfig(
      process.env.EXTERNAL_CATALOG_TARGET_SIZE,
      200000,
      1000,
      5000000,
      'EXTERNAL_CATALOG_TARGET_SIZE',
    ),
    externalCatalogMaxSize: parsePositiveIntConfig(
      process.env.EXTERNAL_CATALOG_MAX_SIZE,
      250000,
      1000,
      5000000,
      'EXTERNAL_CATALOG_MAX_SIZE',
    ),
    hardMaxItemsPerRun: parsePositiveIntConfig(
      process.env.CATALOG_REFRESH_HARD_MAX_ITEMS,
      50,
      1,
      500,
      'CATALOG_REFRESH_HARD_MAX_ITEMS',
    ),
    defaultBatchSize: parsePositiveIntConfig(
      process.env.CATALOG_REFRESH_DEFAULT_BATCH_SIZE,
      25,
      1,
      500,
      'CATALOG_REFRESH_DEFAULT_BATCH_SIZE',
    ),
    liveEnqueueEnabled: parseBooleanConfig(
      process.env.CATALOG_REFRESH_LIVE_ENABLED,
      false,
    ),
    backgroundPaused: parseBooleanConfig(
      process.env.CATALOG_REFRESH_BACKGROUND_PAUSED,
      false,
    ),
    maxConcurrencyPerSource: parsePositiveIntConfig(
      process.env.CATALOG_REFRESH_MAX_CONCURRENCY_PER_SOURCE,
      1,
      1,
      20,
      'CATALOG_REFRESH_MAX_CONCURRENCY_PER_SOURCE',
    ),
    availableFreshnessTtlMs: parsePositiveIntConfig(
      process.env.CATALOG_REFRESH_AVAILABLE_TTL_MS,
      7 * 24 * 60 * 60 * 1000,
      60 * 1000,
      90 * 24 * 60 * 60 * 1000,
      'CATALOG_REFRESH_AVAILABLE_TTL_MS',
    ),
    // Conservative HOT: faster than 7d baseline, not aggressive scrape cadence.
    hotDiscountFreshnessTtlMs: parsePositiveIntConfig(
      process.env.CATALOG_REFRESH_HOT_DISCOUNT_TTL_MS,
      2 * 24 * 60 * 60 * 1000,
      60 * 1000,
      30 * 24 * 60 * 60 * 1000,
      'CATALOG_REFRESH_HOT_DISCOUNT_TTL_MS',
    ),
    warmDemandFreshnessTtlMs: parsePositiveIntConfig(
      process.env.CATALOG_REFRESH_WARM_DEMAND_TTL_MS,
      3 * 24 * 60 * 60 * 1000,
      60 * 1000,
      60 * 24 * 60 * 60 * 1000,
      'CATALOG_REFRESH_WARM_DEMAND_TTL_MS',
    ),
    // Colder than baseline — low-demand products need less verification traffic.
    coldFreshnessTtlMs: parsePositiveIntConfig(
      process.env.CATALOG_REFRESH_COLD_TTL_MS,
      14 * 24 * 60 * 60 * 1000,
      60 * 1000,
      180 * 24 * 60 * 60 * 1000,
      'CATALOG_REFRESH_COLD_TTL_MS',
    ),
    cartDemandLookbackMs: parsePositiveIntConfig(
      process.env.CATALOG_REFRESH_CART_DEMAND_LOOKBACK_MS,
      7 * 24 * 60 * 60 * 1000,
      60 * 1000,
      90 * 24 * 60 * 60 * 1000,
      'CATALOG_REFRESH_CART_DEMAND_LOOKBACK_MS',
    ),
    maxCandidateWindow: parsePositiveIntConfig(
      process.env.CATALOG_REFRESH_MAX_CANDIDATE_WINDOW,
      500,
      50,
      2000,
      'CATALOG_REFRESH_MAX_CANDIDATE_WINDOW',
    ),
    oosRecheckIntervalMs: parsePositiveIntConfig(
      process.env.CATALOG_REFRESH_OOS_RECHECK_MS,
      14 * 24 * 60 * 60 * 1000,
      60 * 1000,
      180 * 24 * 60 * 60 * 1000,
      'CATALOG_REFRESH_OOS_RECHECK_MS',
    ),
    sourceErrorCooldownMs: parsePositiveIntConfig(
      process.env.CATALOG_REFRESH_SOURCE_ERROR_COOLDOWN_MS,
      6 * 60 * 60 * 1000,
      60 * 1000,
      30 * 24 * 60 * 60 * 1000,
      'CATALOG_REFRESH_SOURCE_ERROR_COOLDOWN_MS',
    ),
    circuitFailureThreshold: parsePositiveIntConfig(
      process.env.CATALOG_REFRESH_CB_FAILURE_THRESHOLD,
      8,
      1,
      1000,
      'CATALOG_REFRESH_CB_FAILURE_THRESHOLD',
    ),
    circuitWindowMs: parsePositiveIntConfig(
      process.env.CATALOG_REFRESH_CB_WINDOW_MS,
      15 * 60 * 1000,
      1000,
      24 * 60 * 60 * 1000,
      'CATALOG_REFRESH_CB_WINDOW_MS',
    ),
    circuitCooldownMs: parsePositiveIntConfig(
      process.env.CATALOG_REFRESH_CB_COOLDOWN_MS,
      30 * 60 * 1000,
      1000,
      24 * 60 * 60 * 1000,
      'CATALOG_REFRESH_CB_COOLDOWN_MS',
    ),
    dryRunSampleSize: parsePositiveIntConfig(
      process.env.CATALOG_REFRESH_DRY_RUN_SAMPLE_SIZE,
      15,
      1,
      100,
      'CATALOG_REFRESH_DRY_RUN_SAMPLE_SIZE',
    ),
  };
}

export function assertCatalogLifecycleConfigBounds(
  config: CatalogLifecycleRuntimeConfig,
): void {
  if (config.externalCatalogTargetSize > config.externalCatalogMaxSize) {
    throw new Error(
      'EXTERNAL_CATALOG_TARGET_SIZE must be <= EXTERNAL_CATALOG_MAX_SIZE',
    );
  }
  if (config.defaultBatchSize > config.hardMaxItemsPerRun) {
    throw new Error(
      'CATALOG_REFRESH_DEFAULT_BATCH_SIZE must be <= CATALOG_REFRESH_HARD_MAX_ITEMS',
    );
  }
  if (config.hotDiscountFreshnessTtlMs > config.coldFreshnessTtlMs) {
    throw new Error(
      'CATALOG_REFRESH_HOT_DISCOUNT_TTL_MS must be <= CATALOG_REFRESH_COLD_TTL_MS',
    );
  }
  if (config.warmDemandFreshnessTtlMs > config.coldFreshnessTtlMs) {
    throw new Error(
      'CATALOG_REFRESH_WARM_DEMAND_TTL_MS must be <= CATALOG_REFRESH_COLD_TTL_MS',
    );
  }
  if (config.maxCandidateWindow < config.hardMaxItemsPerRun) {
    throw new Error(
      'CATALOG_REFRESH_MAX_CANDIDATE_WINDOW must be >= CATALOG_REFRESH_HARD_MAX_ITEMS',
    );
  }
}

export function validateCatalogLifecycleRuntimeConfig(): void {
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    return;
  }
  assertCatalogLifecycleConfigBounds(loadCatalogLifecycleRuntimeConfig());
}
