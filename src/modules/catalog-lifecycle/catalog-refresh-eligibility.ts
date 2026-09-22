/**
 * A5 adaptive catalog refresh eligibility — thin facade over the centralized policy.
 * Prefer calculateBackgroundRefreshPriority for new call sites.
 */
import { CatalogLifecycleRuntimeConfig } from './catalog-lifecycle.config';
import {
  AdaptiveRefreshCandidateInput,
  AdaptiveRefreshDecision,
  assertUserImportOutranksCatalogBands,
  calculateBackgroundRefreshPriority,
} from './catalog-refresh-adaptive.policy';

export type CatalogRefreshCandidateInput = AdaptiveRefreshCandidateInput;

export type CatalogRefreshDecision = AdaptiveRefreshDecision;

export {
  assertUserImportOutranksCatalogBands,
  calculateBackgroundRefreshPriority,
  compareAdaptiveRefreshCandidates,
  isCurrentlyDiscounted,
  resolveAvailableRefreshTier,
  freshnessTtlForTier,
} from './catalog-refresh-adaptive.policy';

/**
 * Pure eligibility + priority for curated EXTERNAL refresh.
 * Requires: external_source AND curated membership.
 * Delegates to A5 adaptive policy (discount / demand / freshness tiers).
 */
export function evaluateCatalogRefreshEligibility(
  product: CatalogRefreshCandidateInput,
  now: Date,
  config: CatalogLifecycleRuntimeConfig,
): CatalogRefreshDecision {
  return calculateBackgroundRefreshPriority(product, { now, config });
}
