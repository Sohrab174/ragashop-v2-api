/**
 * Storefront Product Listing query validation + sort keys (PLP-1 / PLP-2).
 * categoryId = CANONICAL category id (never source/import Category.id).
 */

import {
  emptyStorefrontPlpFilters,
  parseStorefrontPlpFilters,
  StorefrontPlpFilters,
} from './storefront-plp.filters';
import {
  STOREFRONT_EFFECTIVE_PRICE_SQL,
  STOREFRONT_REAL_SALE_WHERE_SQL,
  STOREFRONT_VISIBLE_DISCOUNT_SQL,
} from './storefront-plp.pricing';

export const STOREFRONT_PLP_DEFAULT_PAGE = 1;
export const STOREFRONT_PLP_DEFAULT_LIMIT = 24;
export const STOREFRONT_PLP_MAX_LIMIT = 48;

export const STOREFRONT_PLP_SORTS = [
  'default',
  'newest',
  'price_asc',
  'price_desc',
  'discount',
] as const;

export type StorefrontPlpSort = typeof STOREFRONT_PLP_SORTS[number];

export type StorefrontPlpFacetMode = 'full' | 'brands' | 'none';

export type StorefrontPlpQuery = {
  categoryId: number;
  page: number;
  limit: number;
  sort: StorefrontPlpSort;
  filters: StorefrontPlpFilters;
  /**
   * `full` is the public PLP default.
   * Homepage listings use `none` or `brands` so they do not build attribute facets.
   */
  facetMode?: StorefrontPlpFacetMode;
};

export type StorefrontPlpQueryError = {
  code: 'invalid_category' | 'invalid_page' | 'invalid_limit' | 'invalid_sort' | 'invalid_facets';
  message: string;
};

export function parseStorefrontPlpQuery(input: {
  categoryId?: unknown;
  page?: unknown;
  limit?: unknown;
  sort?: unknown;
  brands?: unknown;
  minPrice?: unknown;
  maxPrice?: unknown;
  attrs?: unknown;
  attributes?: unknown;
  facets?: unknown;
}):
  | { ok: true; value: StorefrontPlpQuery }
  | { ok: false; error: StorefrontPlpQueryError } {
  const categoryId = Number(input.categoryId);
  if (
    !Number.isFinite(categoryId) ||
    categoryId <= 0 ||
    !Number.isInteger(categoryId)
  ) {
    return {
      ok: false,
      error: {
        code: 'invalid_category',
        message: 'categoryId must be a positive canonical category id',
      },
    };
  }

  const pageRaw =
    input.page === undefined || input.page === null || input.page === ''
      ? STOREFRONT_PLP_DEFAULT_PAGE
      : Number(input.page);
  if (!Number.isFinite(pageRaw) || pageRaw < 1 || !Number.isInteger(pageRaw)) {
    return {
      ok: false,
      error: { code: 'invalid_page', message: 'page must be an integer >= 1' },
    };
  }

  const limitRaw =
    input.limit === undefined || input.limit === null || input.limit === ''
      ? STOREFRONT_PLP_DEFAULT_LIMIT
      : Number(input.limit);
  if (
    !Number.isFinite(limitRaw) ||
    limitRaw < 1 ||
    !Number.isInteger(limitRaw) ||
    limitRaw > STOREFRONT_PLP_MAX_LIMIT
  ) {
    return {
      ok: false,
      error: {
        code: 'invalid_limit',
        message: `limit must be an integer between 1 and ${STOREFRONT_PLP_MAX_LIMIT}`,
      },
    };
  }

  const sortRaw =
    input.sort === undefined || input.sort === null || input.sort === ''
      ? 'default'
      : String(input.sort);
  if (!(STOREFRONT_PLP_SORTS as readonly string[]).includes(sortRaw)) {
    return {
      ok: false,
      error: {
        code: 'invalid_sort',
        message: `sort must be one of: ${STOREFRONT_PLP_SORTS.join(', ')}`,
      },
    };
  }

  const facetRaw =
    input.facets === undefined || input.facets === null || input.facets === ''
      ? 'full'
      : String(input.facets);
  if (facetRaw !== 'full' && facetRaw !== 'brands' && facetRaw !== 'none') {
    return {
      ok: false,
      error: {
        code: 'invalid_facets',
        message: 'facets must be full, brands, or none',
      },
    };
  }

  const filters = parseStorefrontPlpFilters({
    brands: input.brands,
    minPrice: input.minPrice,
    maxPrice: input.maxPrice,
    attrs: input.attrs,
    attributes: input.attributes,
  });

  return {
    ok: true,
    value: {
      categoryId,
      page: pageRaw,
      limit: limitRaw,
      sort: sortRaw as StorefrontPlpSort,
      filters,
      facetMode: facetRaw,
    },
  };
}

/** @deprecated Use STOREFRONT_EFFECTIVE_PRICE_SQL — kept as alias for call sites. */
export const STOREFRONT_MAIN_PRICE_SQL = STOREFRONT_EFFECTIVE_PRICE_SQL;

export { STOREFRONT_EFFECTIVE_PRICE_SQL, STOREFRONT_VISIBLE_DISCOUNT_SQL };

export { emptyStorefrontPlpFilters };

/**
 * Apply deterministic sort for storefront PLP.
 * Price/discount sorts use the shared real-sale predicate SQL.
 */
export function applyStorefrontPlpSort(
  builder: {
    orderBy: (sort: string, order?: 'ASC' | 'DESC') => unknown;
    addOrderBy: (sort: string, order?: 'ASC' | 'DESC') => unknown;
  },
  sort: StorefrontPlpSort,
): void {
  switch (sort) {
    case 'price_asc':
      builder.orderBy('mainPrice', 'ASC');
      builder.addOrderBy('product.id', 'ASC');
      break;
    case 'price_desc':
      builder.orderBy('mainPrice', 'DESC');
      builder.addOrderBy('product.id', 'ASC');
      break;
    case 'discount':
      // Alias selected alongside mainPrice in CatalogService.
      builder.orderBy('visibleDiscount', 'DESC');
      builder.addOrderBy('product.id', 'ASC');
      break;
    case 'newest':
    case 'default':
    default:
      builder.orderBy('product.id', 'DESC');
      break;
  }
}

/**
 * When sort=discount (Home discount rail / PLP discount / Search discount),
 * restrict to currently discounted products only so ended discounts cannot
 * pad the rail after commercial refresh clears sale fields.
 */
export function applyStorefrontDiscountDiscoveryFilter(builder: {
  andWhere: (condition: string) => unknown;
}): void {
  builder.andWhere(STOREFRONT_REAL_SALE_WHERE_SQL);
}
