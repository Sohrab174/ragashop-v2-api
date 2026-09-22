import { SelectQueryBuilder } from 'typeorm';
import { ProductSupplyType } from '../catalog-lifecycle/catalog-lifecycle.types';
import { SourceCommercialAvailability } from '../source-availability';

/**
 * Phase A4 — customer-facing catalog DISCOVERY eligibility.
 *
 * Distinct from:
 * - Product existence / PDP access (non-curated paste-link must stay reachable)
 * - Commerce purchasability (Cart/Checkout)
 * - Catalog refresh eligibility (A3)
 *
 * External curated discovery requires:
 *   supplyType=external_source
 *   AND isCuratedExternalCatalog=true
 *   AND sourceAvailability NOT IN (unavailable, removed)
 *
 * UNKNOWN and SOURCE_ERROR alone never hide a product.
 * Native marketplace / unclassified keep compatible discovery without
 * requiring source-availability confirmation.
 */

export type DiscoveryEligibilityInput = {
  supplyType: ProductSupplyType | string;
  isCuratedExternalCatalog: boolean;
  sourceAvailability: SourceCommercialAvailability | string;
  status?: string;
  isDeleted?: boolean;
  categoryId?: number | null;
  price?: number | null;
};

export type DiscoveryExclusionReason =
  | 'deleted'
  | 'inactive'
  | 'invalid_price'
  | 'category_not_discoverable'
  | 'not_curated_external'
  | 'confirmed_unavailable'
  | 'removed'
  | null;

export type DiscoveryEligibilityDecision = {
  eligible: boolean;
  reason: DiscoveryExclusionReason;
  detail: string;
};

const STUB_CATEGORY_ID = 1;

/**
 * SQL fragment for discovery membership + external availability suppression.
 * Safe to AND into listing/search/home/category product queries.
 */
export function discoveryEligibilitySql(alias = 'product'): string {
  return `(
    (
      ${alias}.supplyType = '${ProductSupplyType.external_source}'
      AND ${alias}.isCuratedExternalCatalog = 1
      AND ${alias}.sourceAvailability NOT IN (
        '${SourceCommercialAvailability.unavailable}',
        '${SourceCommercialAvailability.removed}'
      )
    )
    OR ${alias}.supplyType = '${ProductSupplyType.native_marketplace}'
    OR ${alias}.supplyType = '${ProductSupplyType.unclassified}'
  )`;
}

/** Apply A4 discovery predicates to a TypeORM product query builder. */
export function applyDiscoveryEligibilityFilters<T>(
  builder: SelectQueryBuilder<T>,
  alias = 'product',
): SelectQueryBuilder<T> {
  return builder.andWhere(discoveryEligibilitySql(alias));
}

/**
 * Pure policy evaluation (tests / diagnostics).
 * Does not replace SQL filtering for listings — use applyDiscoveryEligibilityFilters.
 */
export function evaluateDiscoveryEligibility(
  product: DiscoveryEligibilityInput,
): DiscoveryEligibilityDecision {
  if (product.isDeleted === true) {
    return { eligible: false, reason: 'deleted', detail: 'isDeleted' };
  }
  if (product.status != null && product.status !== 'active') {
    return { eligible: false, reason: 'inactive', detail: 'status_not_active' };
  }
  if (product.price != null && !(Number(product.price) > 0)) {
    return { eligible: false, reason: 'invalid_price', detail: 'price_not_positive' };
  }
  if (
    product.categoryId != null &&
    Number(product.categoryId) === STUB_CATEGORY_ID
  ) {
    return {
      eligible: false,
      reason: 'category_not_discoverable',
      detail: 'stub_category',
    };
  }

  if (product.supplyType === ProductSupplyType.external_source) {
    if (product.isCuratedExternalCatalog !== true) {
      return {
        eligible: false,
        reason: 'not_curated_external',
        detail: 'paste_link_or_non_curated_excluded',
      };
    }
    if (
      product.sourceAvailability === SourceCommercialAvailability.unavailable
    ) {
      return {
        eligible: false,
        reason: 'confirmed_unavailable',
        detail: 'sourceAvailability_unavailable',
      };
    }
    if (product.sourceAvailability === SourceCommercialAvailability.removed) {
      return {
        eligible: false,
        reason: 'removed',
        detail: 'sourceAvailability_removed',
      };
    }
    return {
      eligible: true,
      reason: null,
      detail: 'curated_external_discoverable',
    };
  }

  if (product.supplyType === ProductSupplyType.native_marketplace) {
    return {
      eligible: true,
      reason: null,
      detail: 'native_marketplace_compatible',
    };
  }

  if (product.supplyType === ProductSupplyType.unclassified) {
    return {
      eligible: true,
      reason: null,
      detail: 'unclassified_compatible',
    };
  }

  return {
    eligible: false,
    reason: 'not_curated_external',
    detail: `unknown_supplyType:${product.supplyType}`,
  };
}

/**
 * PLP card `available` from normalized commercial state.
 * Confirmed unavailable/removed are suppressed from discovery; defensive false.
 * UNKNOWN must not claim sold-out → true for customer compatibility.
 * sourceSyncStatus is intentionally ignored.
 */
export function listingCardAvailableFromSourceAvailability(
  sourceAvailability: SourceCommercialAvailability | string | null | undefined,
): boolean {
  if (
    sourceAvailability === SourceCommercialAvailability.unavailable ||
    sourceAvailability === SourceCommercialAvailability.removed
  ) {
    return false;
  }
  return true;
}
