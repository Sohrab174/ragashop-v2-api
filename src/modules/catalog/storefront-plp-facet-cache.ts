/**
 * Bounded in-memory cache for PLP-2 facet payloads.
 *
 * Key MUST exclude page/sort — facets are independent of listing window.
 * Product rows are never cached here (availability stays live on listing).
 */

import {
  serializeStorefrontPlpAttributesParam,
  type StorefrontPlpFilters,
  type StorefrontPlpFiltersPayload,
} from './storefront-plp.filters';

export const STOREFRONT_PLP_FACET_CACHE_TTL_MS = 45_000;
export const STOREFRONT_PLP_FACET_CACHE_MAX_ENTRIES = 64;

/** When set to "1", facet cache get/set are no-ops (cold-miss measurement only). */
export function isStorefrontPlpFacetCacheDisabled(): boolean {
  return process.env.PLP_FACET_CACHE_DISABLED === '1';
}

type CacheEntry = {
  expiresAt: number;
  payload: StorefrontPlpFiltersPayload;
};

const cache = new Map<string, CacheEntry>();

export function buildStorefrontPlpFacetCacheKey(input: {
  sourceCategoryIds: number[];
  filters: StorefrontPlpFilters;
  tryToToman: number;
  /** CAT-3B — audience gender filter must be part of facet identity. */
  audienceGenders?: string[] | null;
}): string {
  const cats = [...input.sourceCategoryIds].sort((a, b) => a - b).join(',');
  const brands = [...input.filters.brandIds].sort((a, b) => a - b).join(',');
  const min =
    input.filters.minPrice == null ? '' : String(input.filters.minPrice);
  const max =
    input.filters.maxPrice == null ? '' : String(input.filters.maxPrice);
  const attrs = serializeStorefrontPlpAttributesParam(input.filters.attributes);
  const rate = Number.isFinite(input.tryToToman)
    ? String(input.tryToToman)
    : '1';
  const genders = input.audienceGenders?.length
    ? [...input.audienceGenders].sort().join(',')
    : '';
  return `cats=${cats}|brands=${brands}|min=${min}|max=${max}|attrs=${attrs}|rate=${rate}|genders=${genders}`;
}

function clonePayload(
  payload: StorefrontPlpFiltersPayload,
): StorefrontPlpFiltersPayload {
  return {
    brands: payload.brands.map((b) => ({ ...b })),
    price: { ...payload.price },
    attributes: payload.attributes.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      values: a.values.map((v) => ({ ...v })),
    })),
  };
}

export function getStorefrontPlpFacetCache(
  key: string,
  now = Date.now(),
): StorefrontPlpFiltersPayload | null {
  if (isStorefrontPlpFacetCacheDisabled()) return null;
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  // Refresh LRU order.
  cache.delete(key);
  cache.set(key, hit);
  return clonePayload(hit.payload);
}

export function setStorefrontPlpFacetCache(
  key: string,
  payload: StorefrontPlpFiltersPayload,
  now = Date.now(),
  ttlMs = STOREFRONT_PLP_FACET_CACHE_TTL_MS,
  maxEntries = STOREFRONT_PLP_FACET_CACHE_MAX_ENTRIES,
): void {
  if (isStorefrontPlpFacetCacheDisabled()) return;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, {
    expiresAt: now + ttlMs,
    payload: clonePayload(payload),
  });
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    cache.delete(oldest);
  }
}

/** Test helper — clears all facet cache entries. */
export function clearStorefrontPlpFacetCache(): void {
  cache.clear();
}

/** Test helper — current entry count. */
export function storefrontPlpFacetCacheSize(): number {
  return cache.size;
}
