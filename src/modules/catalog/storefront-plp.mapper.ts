/**
 * Storefront Product Listing response mapping (PLP-1 / PLP-2).
 *
 * Prices are converted TRY → toman via tryToToman (same as GET /products).
 * Sale / compareAt / discount use the shared real-sale predicate.
 */

import {
  emptyStorefrontPlpFiltersPayload,
  StorefrontPlpAppliedFilters,
  StorefrontPlpFiltersPayload,
  toAppliedStorefrontPlpFilters,
  type StorefrontPlpFilters,
} from './storefront-plp.filters';
import {
  effectiveSellPrice,
  isRealSale,
  visibleDiscountPercent,
} from './storefront-plp.pricing';
import {
  discoveryStockExclusion,
  listingCardAvailableFromSourceAvailability,
  type DiscoveryStockInput,
} from '../product/discovery-eligibility';
import { SourceCommercialAvailability } from '../source-availability';
import { canonicalBrandName } from './canonical-brand-name';
import { isFreshShowcaseDiscount } from '../source-availability/customer-freshness';

export type StorefrontPlpProductItem = {
  id: number;
  name: string;
  image: string | null;
  brand: string | null;
  /** Current customer price (toman). */
  price: number;
  /**
   * Previous / list price (toman) when a real discount applies.
   * Null when no meaningful compare-at price.
   */
  compareAtPrice: number | null;
  /** Discount percent derived from real sale prices. */
  discount: number | null;
  priceIsIndicative?: boolean;
  available: boolean;
};

export type StorefrontPlpResponse = {
  category: {
    id: number;
    name: string;
  };
  items: StorefrontPlpProductItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: StorefrontPlpFiltersPayload;
  appliedFilters: StorefrontPlpAppliedFilters;
};

type RawPlpProduct = DiscoveryStockInput & {
  id: number;
  name: string;
  price: number | null;
  discountedPrice: number | null;
  discountPercent: number | null;
  sourceAvailability?: SourceCommercialAvailability | string | null;
  supplyType?: string | null;
  sourceSyncStatus?: string | null;
  availabilityLastConfirmedAt?: Date | string | null;
  cover?: { pathFile?: string | null } | null;
  brand?: { name?: string | null; sourceName?: string | null } | null;
};

function roundMoney(value: number): number {
  return Math.round(value);
}

/**
 * Map a Product entity row to storefront card fields.
 * Sale semantics match SQL effective-price / discount sort exactly.
 * `available` applies the same policy as discoveryEligibilitySql, so rows
 * reaching discovery are available; false is defensive only. UNKNOWN
 * sourceAvailability is not sold-out.
 */
export function mapStorefrontPlpProduct(
  item: RawPlpProduct,
  tryToToman: number,
): StorefrontPlpProductItem {
  const rate = Number(tryToToman);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('fx_rate_unavailable');
  }
  const listPrice = Number(item.price) || 0;
  const saleAllowed = isFreshShowcaseDiscount(item);
  const salePrice = saleAllowed ? item.discountedPrice : null;
  const hasSale = isRealSale(item.price, salePrice);
  const currentTry = effectiveSellPrice(item.price, salePrice);
  const compareTry = hasSale ? listPrice : null;
  const discount = visibleDiscountPercent(item.price, salePrice);

  const brandName = canonicalBrandName(item.brand);

  return {
    id: item.id,
    name: item.name,
    image: item.cover?.pathFile || null,
    brand: brandName,
    price: roundMoney(currentTry * rate),
    compareAtPrice:
      compareTry != null ? roundMoney(compareTry * rate) : null,
    discount,
    priceIsIndicative:
      item.supplyType === 'external_source' && !saleAllowed,
    available:
      listingCardAvailableFromSourceAvailability(item.sourceAvailability) &&
      discoveryStockExclusion(item) === null,
  };
}

export function buildStorefrontPlpPagination(
  page: number,
  limit: number,
  total: number,
) {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

export function buildEmptyStorefrontPlpResponse(
  category: { id: number; name: string },
  page: number,
  limit: number,
  filters: StorefrontPlpFilters,
): StorefrontPlpResponse {
  return {
    category,
    items: [],
    pagination: buildStorefrontPlpPagination(page, limit, 0),
    filters: emptyStorefrontPlpFiltersPayload(),
    appliedFilters: toAppliedStorefrontPlpFilters(filters),
  };
}
