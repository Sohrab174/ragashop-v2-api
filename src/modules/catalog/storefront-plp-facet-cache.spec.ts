import {
  buildStorefrontPlpFacetCacheKey,
  clearStorefrontPlpFacetCache,
  getStorefrontPlpFacetCache,
  setStorefrontPlpFacetCache,
  storefrontPlpFacetCacheSize,
  STOREFRONT_PLP_FACET_CACHE_MAX_ENTRIES,
} from './storefront-plp-facet-cache';
import type { StorefrontPlpFiltersPayload } from './storefront-plp.filters';

const emptyPayload = (): StorefrontPlpFiltersPayload => ({
  brands: [],
  price: { min: null, max: null },
  attributes: [],
});

describe('storefront-plp-facet-cache', () => {
  beforeEach(() => clearStorefrontPlpFacetCache());

  it('builds keys from scope + filters + rate, not page/sort', () => {
    const filters = {
      brandIds: [2, 1],
      minPrice: 100,
      maxPrice: 500,
      attributes: [
        { attributeId: 18, valueIds: [91] },
        { attributeId: 12, valueIds: [45, 44] },
      ],
    };
    const a = buildStorefrontPlpFacetCacheKey({
      sourceCategoryIds: [9, 3],
      filters,
      tryToToman: 10,
    });
    const b = buildStorefrontPlpFacetCacheKey({
      sourceCategoryIds: [3, 9],
      filters: {
        ...filters,
        brandIds: [1, 2],
        attributes: [
          { attributeId: 12, valueIds: [44, 45] },
          { attributeId: 18, valueIds: [91] },
        ],
      },
      tryToToman: 10,
    });
    expect(a).toBe(b);
    expect(a).toContain('cats=3,9');
    expect(a).toContain('brands=1,2');
    expect(a).toContain('attrs=12:44,45;18:91');
    expect(a).not.toContain('page');
    expect(a).not.toContain('sort');
  });

  it('returns cloned payloads within TTL and misses after expiry', () => {
    const key = 'k1';
    const payload = emptyPayload();
    payload.brands.push({ id: 1, name: 'A', count: 3 });
    setStorefrontPlpFacetCache(key, payload, 1_000, 50);
    const hit = getStorefrontPlpFacetCache(key, 1_020);
    expect(hit?.brands[0]).toEqual({ id: 1, name: 'A', count: 3 });
    hit!.brands[0].count = 99;
    expect(getStorefrontPlpFacetCache(key, 1_025)?.brands[0].count).toBe(3);
    expect(getStorefrontPlpFacetCache(key, 1_060)).toBeNull();
  });

  it('honors PLP_FACET_CACHE_DISABLED for cold-miss measurement', () => {
    const prev = process.env.PLP_FACET_CACHE_DISABLED;
    process.env.PLP_FACET_CACHE_DISABLED = '1';
    try {
      setStorefrontPlpFacetCache('disabled', emptyPayload(), 1_000, 60_000);
      expect(getStorefrontPlpFacetCache('disabled', 1_001)).toBeNull();
      expect(storefrontPlpFacetCacheSize()).toBe(0);
    } finally {
      if (prev == null) delete process.env.PLP_FACET_CACHE_DISABLED;
      else process.env.PLP_FACET_CACHE_DISABLED = prev;
    }
  });

  it('evicts oldest entries when over max size', () => {
    for (let i = 0; i < STOREFRONT_PLP_FACET_CACHE_MAX_ENTRIES + 5; i += 1) {
      setStorefrontPlpFacetCache(`k${i}`, emptyPayload(), 1_000, 60_000);
    }
    expect(storefrontPlpFacetCacheSize()).toBe(
      STOREFRONT_PLP_FACET_CACHE_MAX_ENTRIES,
    );
    expect(getStorefrontPlpFacetCache('k0', 1_001)).toBeNull();
    expect(getStorefrontPlpFacetCache('k5', 1_001)).not.toBeNull();
  });
});
