/**
 * CAT-MAP-V2-C forensic: category-name search boost remains ranking-only.
 * Shared eligibility (V2-B) still constrains the product base when categoryId is set.
 */
import {
  applyCanonicalProductEligibility,
  resolveCanonicalProductEligibility,
} from './canonical-product-eligibility';

describe('CAT-MAP-V2-C search category-name boost vs eligibility', () => {
  it('eligibility predicate still excludes opposite gender under adult scope', () => {
    const eligibility = resolveCanonicalProductEligibility(
      1,
      {
        canonicalRows: [
          {
            id: 1,
            parentId: null,
            status: 'active',
            name: 'زنانه',
            audience: 'female',
          },
          {
            id: 20,
            parentId: 1,
            status: 'active',
            name: 'تیشرت',
            audience: null,
          },
        ],
        mappings: [
          {
            id: 1,
            sourceCategoryId: 100,
            canonicalCategoryId: 20,
            status: 'active',
            source: 'trendyol',
            genderSlice: 'any',
            reviewStatus: 'legacy_unreviewed',
          },
        ],
        sourceTaxonomy: [
          {
            id: 100,
            parentId: null,
            source: 'trendyol',
            status: 'active',
            name: 'T',
          },
        ],
      },
      { sliceRoutingEnabled: false },
    );

    const calls: Array<{ sql: string; params?: Record<string, unknown> }> = [];
    const qb: any = {
      andWhere: (sql: string, params?: Record<string, unknown>) => {
        calls.push({ sql, params });
        return qb;
      },
    };
    applyCanonicalProductEligibility(qb, 'product', eligibility, 'searchElig');

    // Boost may OR category source ids into text candidate matching, but the
    // eligibility gender predicate remains ANDed on the same builder.
    expect(calls.some((c) => c.sql.includes('product.gender'))).toBe(true);
    expect(eligibility.audienceGenders).toEqual(['female', 'unisex']);
  });
});
