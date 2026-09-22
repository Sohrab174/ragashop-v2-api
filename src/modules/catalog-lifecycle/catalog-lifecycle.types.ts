/**
 * Phase A3 Fix #1 — separate supply ownership from curated membership.
 *
 * Ingestion context (customer paste-link vs scheduled) lives on import jobs,
 * not as mutually exclusive Product.catalogOrigin values.
 */

/** Who owns / manages inventory for this Product. */
export enum ProductSupplyType {
  external_source = 'external_source',
  native_marketplace = 'native_marketplace',
  /** source-null / ambiguous historical rows — not assumed marketplace sellers. */
  unclassified = 'unclassified',
}

/**
 * @deprecated A3 mutually exclusive origin. Kept for staged deprecation.
 * Do not use for eligibility/capacity. Prefer supplyType + isCuratedExternalCatalog.
 */
export enum ProductCatalogOrigin {
  external_curated = 'external_curated',
  external_on_demand = 'external_on_demand',
  native_marketplace = 'native_marketplace',
}

/**
 * Queue priority bands (higher claimed first).
 * Customer paste-link imports must always outrank background catalog work.
 */
export enum MarketplaceImportJobPriorityBand {
  USER_IMPORT = 100,
  COMMERCE_PRIORITY = 80,
  CATALOG_HIGH = 40,
  CATALOG_NORMAL = 20,
  CATALOG_LOW = 10,
  OOS_RECHECK = 5,
}

/**
 * Queue priority class for background catalog refresh (A5).
 * COMMERCE_PRIORITY is for discounted / commercially hot curated refresh —
 * still strictly below USER_IMPORT.
 */
export type CatalogRefreshPriorityClass =
  | 'COMMERCE_PRIORITY'
  | 'CATALOG_HIGH'
  | 'CATALOG_NORMAL'
  | 'CATALOG_LOW'
  | 'OOS_RECHECK';

/**
 * Adaptive cadence tiers (A5). Names are stable for observability.
 * HOT = currently discounted curated products
 * WARM = recent cart demand without requiring a discount
 * NORMAL = mid cadence (reserved / sync_stale non-discount)
 * COLD = low-demand ordinary curated products
 * RECOVERY = never_verified / unknown / source_error
 * OOS_RECHECK = confirmed unavailable recheck
 */
export type CatalogRefreshTier =
  | 'HOT'
  | 'WARM'
  | 'NORMAL'
  | 'COLD'
  | 'RECOVERY'
  | 'OOS_RECHECK';

export type CatalogRefreshEligibilityReason =
  | 'never_verified'
  | 'unknown_availability'
  | 'sync_stale'
  | 'source_error_recheck'
  | 'available_stale'
  | 'available_stale_discount'
  | 'available_stale_demand'
  | 'unavailable_recheck';
