import { ProductGender } from '../product/entities/product.entity';
import {
  eligibleProductGendersForAudience,
  resolveCanonicalBrowseAudience,
} from './canonical-audience-policy';
import { buildStorefrontPlpFacetCacheKey } from './storefront-plp-facet-cache';

/**
 * CAT-3B — documents authoritative intersection contract used by CatalogService
 * before pagination (structural scope ∩ eligible genders).
 */
describe('CAT-3B PLP audience intersection contract', () => {
  it('men root filter rejects female-only and null', () => {
    const eligible = new Set(eligibleProductGendersForAudience('men'));
    expect(eligible.has(ProductGender.male)).toBe(true);
    expect(eligible.has(ProductGender.unisex)).toBe(true);
    expect(eligible.has(ProductGender.female)).toBe(false);
    expect(eligible.has(null as unknown as ProductGender)).toBe(false);
  });

  it('women root filter rejects male-only and null', () => {
    const eligible = new Set(eligibleProductGendersForAudience('women'));
    expect(eligible.has(ProductGender.female)).toBe(true);
    expect(eligible.has(ProductGender.unisex)).toBe(true);
    expect(eligible.has(ProductGender.male)).toBe(false);
  });

  it('nested men category inherits men audience from root', () => {
    const rows = [
      { id: 6, parentId: null, name: 'مردانه', audience: 'male' },
      { id: 40, parentId: 6, name: 'پیراهن', audience: null },
    ];
    expect(resolveCanonicalBrowseAudience(40, rows)).toBe('men');
    expect(eligibleProductGendersForAudience('men')).toEqual([
      ProductGender.male,
      ProductGender.unisex,
    ]);
  });

  it('nested women category inherits women audience from root', () => {
    const rows = [
      { id: 1, parentId: null, name: 'زنانه', audience: 'female' },
      { id: 20, parentId: 1, name: 'بلوز', audience: null },
    ];
    expect(resolveCanonicalBrowseAudience(20, rows)).toBe('women');
  });

  it('kids browse stays structural (no adult gender eligibility list)', () => {
    const rows = [
      { id: 11, parentId: null, name: 'بچگانه', audience: 'child' },
      { id: 12, parentId: 11, name: 'پوشاک', audience: null },
    ];
    expect(resolveCanonicalBrowseAudience(12, rows)).toBe('kids');
  });

  it('facet cache key must differ when audience genders differ', () => {
    const filters = {
      brandIds: [] as number[],
      minPrice: null,
      maxPrice: null,
      attributes: [] as Array<{ attributeId: number; valueIds: number[] }>,
    };
    const base = {
      sourceCategoryIds: [1, 2],
      filters,
      tryToToman: 10,
    };
    const men = buildStorefrontPlpFacetCacheKey({
      ...base,
      audienceGenders: ['male', 'unisex'],
    });
    const women = buildStorefrontPlpFacetCacheKey({
      ...base,
      audienceGenders: ['female', 'unisex'],
    });
    const none = buildStorefrontPlpFacetCacheKey(base);
    expect(men).not.toBe(women);
    expect(men).not.toBe(none);
    expect(men).toContain('genders=male,unisex');
  });
});
