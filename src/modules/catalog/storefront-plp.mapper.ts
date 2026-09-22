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
import { listingCardAvailableFromSourceAvailability } from '../product/discovery-eligibility';
import { SourceCommercialAvailability } from '../source-availability';

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

type RawPlpProduct = {
  id: number;
  name: string;
  price: number | null;
  discountedPrice: number | null;
  discountPercent: number | null;
  sourceAvailability?: SourceCommercialAvailability | string | null;
  cover?: { pathFile?: string | null } | null;
  brand?: { name?: string | null; sourceName?: string | null } | null;
};

function roundMoney(value: number): number {
  return Math.round(value);
}

/**
 * Map a Product entity row to storefront card fields.
 * Sale semantics match SQL effective-price / discount sort exactly.
 * `available` uses normalized commercial state (not hardcoded true).
 * UNKNOWN is not sold-out; unavailable/removed are defensive false
 * (those rows should already be suppressed from discovery queries).
 */
export function mapStorefrontPlpProduct(
  item: RawPlpProduct,
  tryToToman: number,
): StorefrontPlpProductItem {
  const listPrice = Number(item.price) || 0;
  const hasSale = isRealSale(item.price, item.discountedPrice);
  const currentTry = effectiveSellPrice(item.price, item.discountedPrice);
  const compareTry = hasSale ? listPrice : null;
  const discount = visibleDiscountPercent(item.price, item.discountedPrice);

  const brandName = item.brand?.name || item.brand?.sourceName || null;

  return {
    id: item.id,
    name: item.name,
    image: item.cover?.pathFile || null,
    brand: brandName,
    price: roundMoney(currentTry * tryToToman),
    compareAtPrice:
      compareTry != null ? roundMoney(compareTry * tryToToman) : null,
    discount,
    available: listingCardAvailableFromSourceAvailability(
      item.sourceAvailability,
    ),
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
