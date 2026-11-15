import { SelectQueryBuilder } from 'typeorm';
import { ProductSupplyType } from '../catalog-lifecycle/catalog-lifecycle.types';
import {
  SourceCommercialAvailability,
  SourceSyncStatus,
} from '../source-availability';
import {
  isFreshShowcaseListing,
  resolveShowcaseListingFreshnessMs,
} from '../source-availability/customer-freshness';
import { applyAssortmentDiscoveryFilter } from '../catalog/assortment-policy/assortment-enforcement';

/**
 * Phase A4 — customer-facing catalog DISCOVERY eligibility.
 *
 * Distinct from:
 * - Product existence / PDP access (non-curated paste-link must stay reachable)
 * - Commerce purchasability (Cart/Checkout) — keeps 5-minute freshness
 * - Discount badges — keep discount freshness via PLP/PDP mappers (default 24h)
 * - Catalog refresh eligibility (A3)
 *
 * When SHOWCASE_VERIFIED_DISCOVERY is enabled (default), ordinary showcase
 * listing allows curated historical products with a usable cover image and
 * non-bulky category, excluding confirmed unavailable/removed. It does NOT
 * require a fresh 48-hour commercial verification for PLP membership.
 *
 * Confirmed stock / guaranteed current price are NOT claimed on the card
 * unless listingCardAvailableFromSourceAvailability / priceIsIndicative
 * say so. Purchase still requires sourceVerificationRequired + 5-minute
 * freshness.
 *
 * Set SHOWCASE_VERIFIED_DISCOVERY=0 to restore the older permissive gate
 * (curated + not unavailable/removed only, no cover/bulky extras).
 */

export const SHOWCASE_VERIFIED_DISCOVERY_ENV = 'SHOWCASE_VERIFIED_DISCOVERY';

/** Default bulky / heavy leaf categories excluded from verified showcase. */
export const DEFAULT_SHOWCASE_BULKY_CATEGORY_IDS: readonly number[] = [
  352, // فرش
  389, // فن پرده
  405, // استور پرده
  361, // پوشش مبل
  457, // سازنده داخلی کمد
  465, // ست مبلمان
  377, // مبلمان باغی
  613, // کمد چندمنظوره
  515, // کمد لباس
  670, // صندلی یا مبل اتاق کودک
  676, // ملافه تخت دو نفره
  467, // سر تخت
  599, // کمد اسباب‌بازی
  608, // پرده توری
  597, // لوازم جانبی پرده
  470, // پوشش فرش
  410, // فرش آشپزخانه
  480, // فرش کودک
];

export type DiscoveryEligibilityInput = {
  supplyType: ProductSupplyType | string;
  isCuratedExternalCatalog: boolean;
  sourceAvailability: SourceCommercialAvailability | string;
  sourceSyncStatus?: SourceSyncStatus | string | null;
  availabilityLastConfirmedAt?: Date | string | null;
  coverId?: number | null;
  status?: string;
  isDeleted?: boolean;
  categoryId?: number | null;
  price?: number | null;
  hasStock?: boolean | null;
  isSellable?: boolean | null;
  quantity?: number | null;
  /** When variants exist: true if at least one PAV has quantity <> 0. */
  hasPurchasableVariant?: boolean | null;
  /** When variants exist: true if any non-deleted PAV rows exist. */
  hasVariants?: boolean | null;
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
  | 'not_verified'
  | 'missing_image'
  | 'bulky_category'
  | 'no_purchasable_variant'
  | null;

export type DiscoveryEligibilityDecision = {
  eligible: boolean;
  reason: DiscoveryExclusionReason;
  detail: string;
};

const STUB_CATEGORY_ID = 1;

export function isShowcaseVerifiedDiscoveryEnabled(
  raw = process.env[SHOWCASE_VERIFIED_DISCOVERY_ENV],
): boolean {
  if (raw == null || String(raw).trim() === '') return true;
  const v = String(raw).trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

export function resolveShowcaseBulkyCategoryIds(
  raw = process.env.SHOWCASE_BULKY_CATEGORY_IDS,
): number[] {
  if (raw == null || String(raw).trim() === '') {
    return [...DEFAULT_SHOWCASE_BULKY_CATEGORY_IDS];
  }
  const ids = String(raw)
    .split(/[,\s]+/)
    .map((p) => Number(p))
    .filter((n) => Number.isInteger(n) && n > 0);
  return ids.length ? ids : [...DEFAULT_SHOWCASE_BULKY_CATEGORY_IDS];
}

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

export function discoveryVariantPurchasableSql(alias = 'product'): string {
  return `(
    NOT EXISTS (
      SELECT 1 FROM product_attribute_value __pav_none
      WHERE __pav_none.productId = ${alias}.id
        AND __pav_none.isDeleted = 0
    )
    OR EXISTS (
      SELECT 1 FROM product_attribute_value __pav_ok
      WHERE __pav_ok.productId = ${alias}.id
        AND __pav_ok.isDeleted = 0
        AND __pav_ok.quantity <> 0
    )
  )`;
}

export function discoveryCoverRequiredSql(alias = 'product'): string {
  return `${alias}.coverId IS NOT NULL`;
}

export function discoveryListingFreshnessSql(
  alias = 'product',
  maxAgeMs = resolveShowcaseListingFreshnessMs(),
): string {
  const seconds = Math.max(60, Math.floor(maxAgeMs / 1000));
  return `(
    ${alias}.availabilityLastConfirmedAt IS NOT NULL
    AND ${alias}.availabilityLastConfirmedAt > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${seconds} SECOND)
  )`;
}

export function discoveryBulkyCategoryExclusionSql(
  alias = 'product',
  bulkyIds = resolveShowcaseBulkyCategoryIds(),
): string {
  if (!bulkyIds.length) return '1=1';
  return `${alias}.categoryId NOT IN (${bulkyIds.join(',')})`;
}

/**
 * Legacy permissive external curated gate (rollback / flag off).
 */
function legacyExternalCuratedSql(alias: string): string {
  return `(
    ${alias}.supplyType = '${ProductSupplyType.external_source}'
    AND ${alias}.isCuratedExternalCatalog = 1
    AND ${alias}.sourceAvailability NOT IN (
      '${SourceCommercialAvailability.unavailable}',
      '${SourceCommercialAvailability.removed}'
    )
  )`;
}

/**
 * Ordinary showcase external curated gate (flag on).
 * Historical curated products may list without 48h commercial verification.
 * Cover + bulky filters keep the rail visually usable and launch-safe.
 */
function ordinaryExternalCuratedSql(alias: string): string {
  return `(
    ${alias}.supplyType = '${ProductSupplyType.external_source}'
    AND ${alias}.isCuratedExternalCatalog = 1
    AND ${alias}.sourceAvailability NOT IN (
      '${SourceCommercialAvailability.unavailable}',
      '${SourceCommercialAvailability.removed}'
    )
    AND ${discoveryCoverRequiredSql(alias)}
    AND ${discoveryBulkyCategoryExclusionSql(alias)}
  )`;
}

/**
 * SQL fragment for discovery membership + external availability suppression.
 * Safe to AND into listing/search/home/category product queries.
 *
 * External curated ordinary showcase is NOT stock-gated here — card
 * `available` / indicative price handle commercial honesty; purchase
 * enforces 5-minute freshness separately. Native/unclassified still use
 * the stock gate.
 */
export function discoveryEligibilitySql(alias = 'product'): string {
  if (!isShowcaseVerifiedDiscoveryEnabled()) {
    return `(
      (
        ${legacyExternalCuratedSql(alias)}
        OR ${alias}.supplyType = '${ProductSupplyType.native_marketplace}'
        OR ${alias}.supplyType = '${ProductSupplyType.unclassified}'
      )
      AND ${discoveryPurchasableSql(alias)}
    )`;
  }

  return `(
    ${ordinaryExternalCuratedSql(alias)}
    OR (
      (
        ${alias}.supplyType = '${ProductSupplyType.native_marketplace}'
        OR ${alias}.supplyType = '${ProductSupplyType.unclassified}'
      )
      AND ${discoveryPurchasableSql(alias)}
    )
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
 * Ordinary showcase extras for curated external listing membership.
 * Cover + bulky only — freshness is NOT a listing membership requirement.
 * Confirmed availability claims stay on listingCardAvailableFromSourceAvailability.
 */
function evaluateOrdinaryExternalExtras(
  product: DiscoveryEligibilityInput,
): DiscoveryEligibilityDecision | null {
  if (product.coverId == null) {
    return {
      eligible: false,
      reason: 'missing_image',
      detail: 'coverId_required',
    };
  }
  const categoryId = product.categoryId != null ? Number(product.categoryId) : null;
  if (
    categoryId != null &&
    resolveShowcaseBulkyCategoryIds().includes(categoryId)
  ) {
    return {
      eligible: false,
      reason: 'bulky_category',
      detail: `categoryId_${categoryId}`,
    };
  }
  return null;
}

/**
 * Pure policy evaluation (tests / diagnostics).
 * Does not replace SQL filtering for listings — use applyDiscoveryEligibilityFilters.
 */
export function evaluateDiscoveryEligibility(
  product: DiscoveryEligibilityInput,
  now = Date.now(),
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
  // Ordinary curated showcase may list without confirmed stock evidence.
  // Native / unclassified still require the stock gate for discovery.
  if (
    stockExclusion &&
    product.supplyType !== ProductSupplyType.external_source
  ) {
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

    if (isShowcaseVerifiedDiscoveryEnabled()) {
      const extras = evaluateOrdinaryExternalExtras(product);
      if (extras) return extras;
    }

    return {
      eligible: true,
      reason: null,
      detail: isShowcaseVerifiedDiscoveryEnabled()
        ? 'curated_external_ordinary_showcase'
        : 'curated_external_discoverable',
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
 * PLP card `available` = confirmed commercially available.
 * Confirmed unavailable/removed are false.
 * Under ordinary showcase (flag on), unknown/stale/never_verified must not
 * claim confirmed available — they may still appear with indicative price.
 */
export function listingCardAvailableFromSourceAvailability(
  sourceAvailability: SourceCommercialAvailability | string | null | undefined,
  extras?: {
    supplyType?: string | null;
    sourceSyncStatus?: string | null;
    availabilityLastConfirmedAt?: Date | string | null;
    now?: number;
  },
): boolean {
  if (
    sourceAvailability === SourceCommercialAvailability.unavailable ||
    sourceAvailability === SourceCommercialAvailability.removed
  ) {
    return false;
  }
  if (
    isShowcaseVerifiedDiscoveryEnabled() &&
    extras?.supplyType === ProductSupplyType.external_source
  ) {
    return isFreshShowcaseListing(
      {
        supplyType: extras.supplyType,
        sourceAvailability,
        sourceSyncStatus: extras.sourceSyncStatus,
        availabilityLastConfirmedAt: extras.availabilityLastConfirmedAt,
      },
      extras.now ?? Date.now(),
    );
  }
  return true;
}
