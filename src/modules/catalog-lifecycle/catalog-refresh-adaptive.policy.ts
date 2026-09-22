import { isRealSale } from '../catalog/storefront-plp.pricing';
import {
  SourceCommercialAvailability,
  SourceSyncStatus,
} from '../source-availability';
import { CatalogLifecycleRuntimeConfig } from './catalog-lifecycle.config';
import {
  CatalogRefreshEligibilityReason,
  CatalogRefreshPriorityClass,
  CatalogRefreshTier,
  MarketplaceImportJobPriorityBand,
  ProductSupplyType,
} from './catalog-lifecycle.types';
import { isCuratedExternalMember } from './catalog-membership.util';

/**
 * A5 adaptive background refresh — single authoritative policy.
 *
 * Does not invent analytics. Demand is optional and only used when
 * `hasRecentCartDemand` is supplied by the executor from existing cart_item rows.
 */

export type AdaptiveRefreshCandidateInput = {
  id: number;
  source: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  supplyType: ProductSupplyType | string;
  isCuratedExternalCatalog: boolean;
  sourceAvailability: SourceCommercialAvailability | string;
  sourceSyncStatus: SourceSyncStatus | string;
  availabilityLastConfirmedAt: Date | null;
  sourceLastAttemptAt: Date | null;
  createdAt: Date;
  price?: number | null;
  discountedPrice?: number | null;
  /** True when product appears in a recent active cart (executor-supplied). */
  hasRecentCartDemand?: boolean;
};

export type AdaptiveRefreshDecision = {
  eligible: boolean;
  reason?: CatalogRefreshEligibilityReason;
  priorityClass?: CatalogRefreshPriorityClass;
  tier?: CatalogRefreshTier;
  priority: number;
  detail: string;
  currentlyDiscounted: boolean;
  freshnessAgeMs: number | null;
  assignedTtlMs: number | null;
};

export type AdaptiveRefreshContext = {
  now: Date;
  config: CatalogLifecycleRuntimeConfig;
};

function isPast(
  at: Date | null | undefined,
  now: Date,
  intervalMs: number,
): boolean {
  if (!at) return true;
  return now.getTime() - at.getTime() >= intervalMs;
}

function freshnessAgeMs(
  at: Date | null | undefined,
  now: Date,
): number | null {
  if (!at) return null;
  const age = now.getTime() - at.getTime();
  return Number.isFinite(age) ? age : null;
}

/** Authoritative current-discount predicate for A5 (matches storefront isRealSale). */
export function isCurrentlyDiscounted(product: {
  price?: number | null;
  discountedPrice?: number | null;
}): boolean {
  return isRealSale(product.price, product.discountedPrice);
}

/**
 * Resolve adaptive cadence tier for an otherwise-available curated product.
 * Recovery / OOS paths set their own tiers in the main decision function.
 */
export function resolveAvailableRefreshTier(product: {
  price?: number | null;
  discountedPrice?: number | null;
  hasRecentCartDemand?: boolean;
}): CatalogRefreshTier {
  if (isCurrentlyDiscounted(product)) {
    return 'HOT';
  }
  if (product.hasRecentCartDemand === true) {
    return 'WARM';
  }
  return 'COLD';
}

export function freshnessTtlForTier(
  tier: CatalogRefreshTier,
  config: CatalogLifecycleRuntimeConfig,
): number {
  switch (tier) {
    case 'HOT':
      return config.hotDiscountFreshnessTtlMs;
    case 'WARM':
      return config.warmDemandFreshnessTtlMs;
    case 'NORMAL':
      return config.availableFreshnessTtlMs;
    case 'COLD':
      return config.coldFreshnessTtlMs;
    case 'RECOVERY':
      return config.sourceErrorCooldownMs;
    case 'OOS_RECHECK':
      return config.oosRecheckIntervalMs;
    default:
      return config.availableFreshnessTtlMs;
  }
}

function priorityForClass(
  priorityClass: CatalogRefreshPriorityClass,
): number {
  switch (priorityClass) {
    case 'COMMERCE_PRIORITY':
      return MarketplaceImportJobPriorityBand.COMMERCE_PRIORITY;
    case 'CATALOG_HIGH':
      return MarketplaceImportJobPriorityBand.CATALOG_HIGH;
    case 'CATALOG_NORMAL':
      return MarketplaceImportJobPriorityBand.CATALOG_NORMAL;
    case 'CATALOG_LOW':
      return MarketplaceImportJobPriorityBand.CATALOG_LOW;
    case 'OOS_RECHECK':
      return MarketplaceImportJobPriorityBand.OOS_RECHECK;
    default:
      return MarketplaceImportJobPriorityBand.CATALOG_LOW;
  }
}

/**
 * Central adaptive eligibility + priority for curated EXTERNAL background refresh.
 * Prefer this over scattering TTL/priority magic numbers in the executor.
 */
export function calculateBackgroundRefreshPriority(
  product: AdaptiveRefreshCandidateInput,
  context: AdaptiveRefreshContext,
): AdaptiveRefreshDecision {
  const { now, config } = context;
  const currentlyDiscounted = isCurrentlyDiscounted(product);
  const age = freshnessAgeMs(product.availabilityLastConfirmedAt, now);

  const baseMeta = {
    currentlyDiscounted,
    freshnessAgeMs: age,
  };

  if (
    !isCuratedExternalMember({
      supplyType: product.supplyType,
      isCuratedExternalCatalog: product.isCuratedExternalCatalog,
    })
  ) {
    return {
      eligible: false,
      priority: 0,
      detail: `excluded_not_curated_external:${product.supplyType}:${product.isCuratedExternalCatalog}`,
      assignedTtlMs: null,
      ...baseMeta,
    };
  }

  if (!product.source || !product.sourceId) {
    return {
      eligible: false,
      priority: 0,
      detail: 'missing_source_identity',
      assignedTtlMs: null,
      ...baseMeta,
    };
  }

  if (product.sourceAvailability === SourceCommercialAvailability.removed) {
    return {
      eligible: false,
      priority: 0,
      detail: 'removed_excluded_from_normal_refresh',
      assignedTtlMs: null,
      ...baseMeta,
    };
  }

  // SOURCE_ERROR cooldown takes precedence over UNKNOWN/AVAILABLE/UNAVAILABLE
  // immediate eligibility so a failed attempt cannot retry every cycle.
  if (product.sourceSyncStatus === SourceSyncStatus.source_error) {
    if (isPast(product.sourceLastAttemptAt, now, config.sourceErrorCooldownMs)) {
      const priorityClass: CatalogRefreshPriorityClass = 'CATALOG_NORMAL';
      return {
        eligible: true,
        reason: 'source_error_recheck',
        priorityClass,
        tier: 'RECOVERY',
        priority: priorityForClass(priorityClass),
        detail: 'source_error_cooldown_elapsed',
        assignedTtlMs: config.sourceErrorCooldownMs,
        ...baseMeta,
      };
    }
    return {
      eligible: false,
      priority: 0,
      detail: 'source_error_in_cooldown',
      assignedTtlMs: config.sourceErrorCooldownMs,
      ...baseMeta,
    };
  }

  if (product.sourceSyncStatus === SourceSyncStatus.never_verified) {
    const priorityClass: CatalogRefreshPriorityClass = 'CATALOG_HIGH';
    return {
      eligible: true,
      reason: 'never_verified',
      priorityClass,
      tier: 'RECOVERY',
      priority: priorityForClass(priorityClass),
      detail: 'never_verified_curated',
      assignedTtlMs: 0,
      ...baseMeta,
    };
  }

  if (product.sourceAvailability === SourceCommercialAvailability.unknown) {
    const priorityClass: CatalogRefreshPriorityClass = 'CATALOG_HIGH';
    return {
      eligible: true,
      reason: 'unknown_availability',
      priorityClass,
      tier: 'RECOVERY',
      priority: priorityForClass(priorityClass),
      detail: 'unknown_commercial_state',
      assignedTtlMs: 0,
      ...baseMeta,
    };
  }

  if (product.sourceAvailability === SourceCommercialAvailability.unavailable) {
    if (
      isPast(
        product.availabilityLastConfirmedAt,
        now,
        config.oosRecheckIntervalMs,
      )
    ) {
      const priorityClass: CatalogRefreshPriorityClass = 'OOS_RECHECK';
      return {
        eligible: true,
        reason: 'unavailable_recheck',
        priorityClass,
        tier: 'OOS_RECHECK',
        priority: priorityForClass(priorityClass),
        detail: 'confirmed_unavailable_recheck_due',
        assignedTtlMs: config.oosRecheckIntervalMs,
        ...baseMeta,
      };
    }
    return {
      eligible: false,
      priority: 0,
      detail: 'unavailable_recheck_not_due',
      assignedTtlMs: config.oosRecheckIntervalMs,
      ...baseMeta,
    };
  }

  if (product.sourceSyncStatus === SourceSyncStatus.stale) {
    const priorityClass: CatalogRefreshPriorityClass = currentlyDiscounted
      ? 'COMMERCE_PRIORITY'
      : 'CATALOG_NORMAL';
    return {
      eligible: true,
      reason: 'sync_stale',
      priorityClass,
      tier: currentlyDiscounted ? 'HOT' : 'NORMAL',
      priority: priorityForClass(priorityClass),
      detail: currentlyDiscounted ? 'marked_stale_discounted' : 'marked_stale',
      assignedTtlMs: 0,
      ...baseMeta,
    };
  }

  if (product.sourceAvailability === SourceCommercialAvailability.available) {
    const tier = resolveAvailableRefreshTier(product);
    // Non-discounted, non-demand products use COLD; demand without discount = WARM;
    // discount = HOT. NORMAL tier is reserved for explicit mid cadence if needed.
    const effectiveTier: CatalogRefreshTier =
      tier === 'COLD' && !currentlyDiscounted && !product.hasRecentCartDemand
        ? 'COLD'
        : tier;
    const ttl = freshnessTtlForTier(effectiveTier, config);

    if (
      isPast(product.availabilityLastConfirmedAt, now, ttl)
    ) {
      let priorityClass: CatalogRefreshPriorityClass = 'CATALOG_LOW';
      let reason: CatalogRefreshEligibilityReason = 'available_stale';
      let detail = 'available_confirmation_past_ttl';

      if (effectiveTier === 'HOT') {
        priorityClass = 'COMMERCE_PRIORITY';
        reason = 'available_stale_discount';
        detail = 'discounted_past_hot_ttl';
      } else if (effectiveTier === 'WARM') {
        priorityClass = 'CATALOG_HIGH';
        reason = 'available_stale_demand';
        detail = 'cart_demand_past_warm_ttl';
      } else if (effectiveTier === 'COLD') {
        priorityClass = 'CATALOG_LOW';
        reason = 'available_stale';
        detail = 'cold_past_cold_ttl';
      }

      return {
        eligible: true,
        reason,
        priorityClass,
        tier: effectiveTier,
        priority: priorityForClass(priorityClass),
        detail,
        assignedTtlMs: ttl,
        ...baseMeta,
      };
    }

    return {
      eligible: false,
      priority: 0,
      detail:
        effectiveTier === 'HOT'
          ? 'available_fresh_hot'
          : effectiveTier === 'WARM'
            ? 'available_fresh_warm'
            : 'available_fresh',
      tier: effectiveTier,
      assignedTtlMs: ttl,
      ...baseMeta,
    };
  }

  return {
    eligible: false,
    priority: 0,
    detail: 'no_matching_rule',
    assignedTtlMs: null,
    ...baseMeta,
  };
}

/** Deterministic sort: higher priority first, older confirmation, then id. */
export function compareAdaptiveRefreshCandidates(
  a: { decision: AdaptiveRefreshDecision; product: AdaptiveRefreshCandidateInput },
  b: { decision: AdaptiveRefreshDecision; product: AdaptiveRefreshCandidateInput },
): number {
  if (b.decision.priority !== a.decision.priority) {
    return b.decision.priority - a.decision.priority;
  }
  const aAt = a.product.availabilityLastConfirmedAt?.getTime() ?? 0;
  const bAt = b.product.availabilityLastConfirmedAt?.getTime() ?? 0;
  if (aAt !== bAt) {
    return aAt - bAt;
  }
  return a.product.id - b.product.id;
}

/** User import priority must exceed every catalog / commerce background band. */
export function assertUserImportOutranksCatalogBands(): boolean {
  return (
    MarketplaceImportJobPriorityBand.USER_IMPORT >
      MarketplaceImportJobPriorityBand.COMMERCE_PRIORITY &&
    MarketplaceImportJobPriorityBand.COMMERCE_PRIORITY >
      MarketplaceImportJobPriorityBand.CATALOG_HIGH &&
    MarketplaceImportJobPriorityBand.CATALOG_HIGH >
      MarketplaceImportJobPriorityBand.CATALOG_NORMAL &&
    MarketplaceImportJobPriorityBand.CATALOG_NORMAL >
      MarketplaceImportJobPriorityBand.CATALOG_LOW &&
    MarketplaceImportJobPriorityBand.CATALOG_LOW >
      MarketplaceImportJobPriorityBand.OOS_RECHECK
  );
}
