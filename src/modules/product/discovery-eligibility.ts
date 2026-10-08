import { SelectQueryBuilder } from 'typeorm';
import { ProductSupplyType } from '../catalog-lifecycle/catalog-lifecycle.types';
import { SourceCommercialAvailability } from '../source-availability';
import { applyAssortmentDiscoveryFilter } from '../catalog/assortment-policy/assortment-enforcement';

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
  hasStock?: boolean | null;
  isSellable?: boolean | null;
  quantity?: number | null;
};

export type DiscoveryExclusionReason =
  | 'deleted'
  | 'inactive'
  | 'invalid_price'
  | 'category_not_discoverable'
  | 'not_curated_external'
  | 'confirmed_unavailable'
  | 'removed'
  | 'not_purchasable'
  | null;

export type DiscoveryEligibilityDecision = {
  eligible: boolean;
  reason: DiscoveryExclusionReason;
  detail: string;
};

const STUB_CATEGORY_ID = 1;

/**
 * Discovery stock gate (read-only over existing columns; C1 inventory semantics unchanged).
 * - isSellable = 1 and quantity <> 0 (quantity -1 = untracked, not sold out)
 * - hasStock = 1, except native_marketplace where `quantity` is authoritative
 *   (native hasStock is only derived at create time).
 * PDP by id is not gated here and may still render «ناموجود».
 */
export function discoveryPurchasableSql(alias = 'product'): string {
  return `(
    ${alias}.isSellable = 1
    AND ${alias}.quantity <> 0
    AND (
      ${alias}.hasStock = 1
      OR ${alias}.supplyType = '${ProductSupplyType.native_marketplace}'
    )
  )`;
}

export type DiscoveryStockInput = {
  supplyType?: ProductSupplyType | string | null;
  hasStock?: boolean | number | null;
  isSellable?: boolean | number | null;
  quantity?: number | string | null;
};

export type DiscoveryStockExclusion =
  | 'isSellable_false'
  | 'quantity_zero'
  | 'hasStock_false'
  | null;

function isFalseFlag(value: boolean | number | null | undefined): boolean {
  return value === false || value === 0;
}

/**
 * In-memory mirror of discoveryPurchasableSql. Missing (null/undefined)
 * fields are treated as no evidence, never as unavailable.
 */
export function discoveryStockExclusion(
  product: DiscoveryStockInput,
): DiscoveryStockExclusion {
  if (isFalseFlag(product.isSellable)) return 'isSellable_false';
  if (product.quantity != null && Number(product.quantity) === 0) {
    return 'quantity_zero';
  }
  if (
    isFalseFlag(product.hasStock) &&
    product.supplyType !== ProductSupplyType.native_marketplace
  ) {
    return 'hasStock_false';
  }
  return null;
}

/**
 * SQL fragment for discovery membership + external availability suppression
 * + stock gate. Safe to AND into listing/search/home/category product queries.
 */
export function discoveryEligibilitySql(alias = 'product'): string {
  return `(
    (
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
    )
    AND ${discoveryPurchasableSql(alias)}
  )`;
}

/**
 * Apply A4 discovery predicates to a TypeORM product query builder.
 * When ASSORTMENT_DISCOVERY_ENFORCEMENT=1, also requires IN_SCOPE resolution
 * (shared path for PLP / Search / home — no scattered per-controller filters).
 */
export function applyDiscoveryEligibilityFilters<T>(
  builder: SelectQueryBuilder<T>,
  alias = 'product',
): SelectQueryBuilder<T> {
  builder.andWhere(discoveryEligibilitySql(alias));
  return applyAssortmentDiscoveryFilter(builder, alias);
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
    return {
      eligible: false,
      reason: 'invalid_price',
      detail: 'price_not_positive',
    };
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

  const stockExclusion = discoveryStockExclusion(product);
  if (stockExclusion) {
    return {
      eligible: false,
      reason: 'not_purchasable',
      detail: stockExclusion,
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
