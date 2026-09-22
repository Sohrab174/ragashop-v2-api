/**
 * Storefront catalog search query validation (Search Engine V1).
 */

import {
  emptyStorefrontPlpFilters,
  parseStorefrontPlpFilters,
  StorefrontPlpFilters,
} from '../catalog/storefront-plp.filters';
import {
  STOREFRONT_PLP_DEFAULT_LIMIT,
  STOREFRONT_PLP_DEFAULT_PAGE,
  STOREFRONT_PLP_MAX_LIMIT,
  STOREFRONT_PLP_SORTS,
  StorefrontPlpSort,
} from '../catalog/storefront-plp.query';
import {
  normalizeSearchQuery,
  SEARCH_MAX_QUERY_LENGTH,
} from './search-normalize';

export const STOREFRONT_SEARCH_SORTS = [
  'relevance',
  ...STOREFRONT_PLP_SORTS,
] as const;

export type StorefrontSearchSort = typeof STOREFRONT_SEARCH_SORTS[number];

export type StorefrontSearchQuery = {
  q: string;
  normalizedQ: string;
  tokens: string[];
  page: number;
  limit: number;
  sort: StorefrontSearchSort;
  /** Optional canonical category scope filter. */
  categoryId: number | null;
  filters: StorefrontPlpFilters;
};

export type StorefrontSearchQueryError = {
  code:
    | 'invalid_q'
    | 'q_too_long'
    | 'invalid_page'
    | 'invalid_limit'
    | 'invalid_sort'
    | 'invalid_category';
  message: string;
};

export function parseStorefrontSearchQuery(input: {
  q?: unknown;
  page?: unknown;
  limit?: unknown;
  sort?: unknown;
  categoryId?: unknown;
  brands?: unknown;
  minPrice?: unknown;
  maxPrice?: unknown;
  attrs?: unknown;
  attributes?: unknown;
}):
  | { ok: true; value: StorefrontSearchQuery }
  | { ok: false; error: StorefrontSearchQueryError } {
  if (input.q === undefined || input.q === null) {
    return {
      ok: false,
      error: { code: 'invalid_q', message: 'عبارت جستجو الزامی است.' },
    };
  }
  const rawQ = String(input.q);
  if (!rawQ.trim()) {
    return {
      ok: false,
      error: { code: 'invalid_q', message: 'عبارت جستجو الزامی است.' },
    };
  }
  if (rawQ.trim().length > SEARCH_MAX_QUERY_LENGTH) {
    return {
      ok: false,
      error: {
        code: 'q_too_long',
        message: `حداکثر طول عبارت جستجو ${SEARCH_MAX_QUERY_LENGTH} نویسه است.`,
      },
    };
  }

  const normalized = normalizeSearchQuery(rawQ);
  if (!normalized.normalized || normalized.tokens.length === 0) {
    return {
      ok: false,
      error: { code: 'invalid_q', message: 'عبارت جستجو نامعتبر است.' },
    };
  }

  const pageRaw =
    input.page === undefined || input.page === null || input.page === ''
      ? STOREFRONT_PLP_DEFAULT_PAGE
      : Number(input.page);
  if (!Number.isFinite(pageRaw) || pageRaw < 1 || !Number.isInteger(pageRaw)) {
    return {
      ok: false,
      error: { code: 'invalid_page', message: 'شماره صفحه نامعتبر است.' },
    };
  }
  // Soft bound pathological pagination (DB still paginates; reject absurd pages).
  if (pageRaw > 10_000) {
    return {
      ok: false,
      error: { code: 'invalid_page', message: 'شماره صفحه نامعتبر است.' },
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
        message: `تعداد نتایج باید بین ۱ و ${STOREFRONT_PLP_MAX_LIMIT} باشد.`,
      },
    };
  }

  const sortRaw =
    input.sort === undefined || input.sort === null || input.sort === ''
      ? 'relevance'
      : String(input.sort);
  if (!(STOREFRONT_SEARCH_SORTS as readonly string[]).includes(sortRaw)) {
    return {
      ok: false,
      error: {
        code: 'invalid_sort',
        message: `مرتب‌سازی باید یکی از این مقادیر باشد: ${STOREFRONT_SEARCH_SORTS.join(
          ', ',
        )}`,
      },
    };
  }

  let categoryId: number | null = null;
  if (
    input.categoryId !== undefined &&
    input.categoryId !== null &&
    input.categoryId !== ''
  ) {
    const n = Number(input.categoryId);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      return {
        ok: false,
        error: {
          code: 'invalid_category',
          message: 'شناسه دسته نامعتبر است.',
        },
      };
    }
    categoryId = n;
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
      q: normalized.raw,
      normalizedQ: normalized.normalized,
      tokens: normalized.tokens,
      page: pageRaw,
      limit: limitRaw,
      sort: sortRaw as StorefrontSearchSort,
      categoryId,
      filters: filters ?? emptyStorefrontPlpFilters(),
    },
  };
}

export function isCommercialSearchSort(
  sort: StorefrontSearchSort,
): sort is StorefrontPlpSort {
  return (STOREFRONT_PLP_SORTS as readonly string[]).includes(sort);
}
