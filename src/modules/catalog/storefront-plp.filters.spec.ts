import {
  applyStorefrontPlpFilters,
  hasActiveStorefrontPlpFilters,
  parseStorefrontPlpAttributesParam,
  parseStorefrontPlpFilters,
  sanitizeStorefrontPlpAttributeOwnership,
  serializeStorefrontPlpAttributesParam,
  tomanBoundsToTry,
  tryPriceToToman,
  STOREFRONT_PLP_MAX_BRAND_IDS,
} from './storefront-plp.filters';
import { parseStorefrontPlpQuery } from './storefront-plp.query';
import { STOREFRONT_EFFECTIVE_PRICE_SQL } from './storefront-plp.pricing';

describe('storefront-plp.filters parse', () => {
  it('parses brands with dedupe, sort, and bound', () => {
    const filters = parseStorefrontPlpFilters({
      brands: '18,12,12,abc,-1,0,44',
    });
    expect(filters.brandIds).toEqual([12, 18, 44]);
  });

  it('caps brand ids', () => {
    const many = Array.from({ length: 80 }, (_, i) => i + 1).join(',');
    const filters = parseStorefrontPlpFilters({ brands: many });
    expect(filters.brandIds.length).toBe(STOREFRONT_PLP_MAX_BRAND_IDS);
  });

  it('parses price bounds and drops invalid range / zero', () => {
    expect(
      parseStorefrontPlpFilters({ minPrice: '100', maxPrice: '500' }),
    ).toMatchObject({ minPrice: 100, maxPrice: 500 });
    expect(
      parseStorefrontPlpFilters({ minPrice: '500', maxPrice: '100' }),
    ).toMatchObject({ minPrice: null, maxPrice: null });
    expect(
      parseStorefrontPlpFilters({ minPrice: '-1', maxPrice: '10' }),
    ).toMatchObject({ minPrice: null, maxPrice: 10 });
    expect(
      parseStorefrontPlpFilters({ minPrice: '0', maxPrice: '0' }),
    ).toMatchObject({ minPrice: null, maxPrice: null });
    expect(
      parseStorefrontPlpFilters({ minPrice: '0', maxPrice: '5000' }),
    ).toMatchObject({ minPrice: null, maxPrice: 5000 });
  });

  it('parses attrs with OR-within / AND-across serialization', () => {
    const attrs = parseStorefrontPlpAttributesParam('18:91;12:45,44,44;bad');
    expect(attrs).toEqual([
      { attributeId: 12, valueIds: [44, 45] },
      { attributeId: 18, valueIds: [91] },
    ]);
    expect(serializeStorefrontPlpAttributesParam(attrs)).toBe('12:44,45;18:91');
  });

  it('ignores malformed attribute tokens', () => {
    expect(parseStorefrontPlpAttributesParam('12')).toEqual([]);
    expect(parseStorefrontPlpAttributesParam(':1')).toEqual([]);
    expect(parseStorefrontPlpAttributesParam('x:1,2')).toEqual([]);
    expect(parseStorefrontPlpAttributesParam('12:')).toEqual([]);
  });

  it('round-trips through parseStorefrontPlpQuery filters', () => {
    const parsed = parseStorefrontPlpQuery({
      categoryId: 2,
      brands: '10,15',
      minPrice: '1000000',
      maxPrice: '5000000',
      attrs: '12:44,45;18:91',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.filters).toEqual({
      brandIds: [10, 15],
      minPrice: 1000000,
      maxPrice: 5000000,
      attributes: [
        { attributeId: 12, valueIds: [44, 45] },
        { attributeId: 18, valueIds: [91] },
      ],
    });
    expect(hasActiveStorefrontPlpFilters(parsed.value.filters)).toBe(true);
  });
});

describe('storefront-plp.filters apply semantics', () => {
  it('applies brand OR, price bounds, and attribute IN groups', () => {
    const clauses: Array<{ where: string; params?: Record<string, unknown> }> =
      [];
    const builder = {
      andWhere: (where: string, params?: Record<string, unknown>) => {
        clauses.push({ where, params });
        return builder;
      },
    };

    applyStorefrontPlpFilters(
      builder,
      {
        brandIds: [1, 2],
        minPrice: 1000,
        maxPrice: 5000,
        attributes: [
          { attributeId: 12, valueIds: [44, 45] },
          { attributeId: 18, valueIds: [91] },
        ],
      },
      10,
    );

    expect(clauses[0].where).toContain('product.brandId IN');
    expect(clauses[0].params).toEqual({ plpBrandIds: [1, 2] });

    expect(clauses[1].where).toContain(STOREFRONT_EFFECTIVE_PRICE_SQL);
    expect(clauses[1].params).toEqual({ plpMinTry: 100 });
    expect(clauses[2].params).toEqual({ plpMaxTry: 500 });

    expect(clauses[3].where).toContain('product.id IN');
    expect(clauses[3].where).toContain('attribute_value av_f');
    expect(clauses[3].where).toContain('av_f.attributeId = :plpAttrId_12');
    expect(clauses[3].params).toEqual({
      plpAttrId_12: 12,
      plpAttrVals_12: [44, 45],
    });
    expect(clauses[4].params).toEqual({
      plpAttrId_18: 18,
      plpAttrVals_18: [91],
    });
  });

  it('binds supplied attributeId ownership so foreign values cannot remap', () => {
    const clauses: Array<{ where: string; params?: Record<string, unknown> }> =
      [];
    const builder = {
      andWhere: (where: string, params?: Record<string, unknown>) => {
        clauses.push({ where, params });
        return builder;
      },
    };

    // value 116 claimed under bogus attribute 999999 — must still bind 999999,
    // never silently treat as whatever attribute actually owns 116.
    applyStorefrontPlpFilters(
      builder,
      {
        brandIds: [],
        minPrice: null,
        maxPrice: null,
        attributes: [
          { attributeId: 999999, valueIds: [116] },
          { attributeId: 5, valueIds: [116, 200] },
        ],
      },
      1,
    );

    expect(clauses).toHaveLength(2);
    expect(clauses[0].params).toEqual({
      plpAttrId_999999: 999999,
      plpAttrVals_999999: [116],
    });
    expect(clauses[1].params).toEqual({
      plpAttrId_5: 5,
      plpAttrVals_5: [116, 200],
    });
    expect(clauses[0].where).toMatch(/av_f\.attributeId = :plpAttrId_999999/);
    expect(clauses[1].where).toMatch(/av_f\.attributeId = :plpAttrId_5/);
    expect(clauses[0].where).toContain('product.id IN');
  });

  it('sanitizes ownership by ignoring foreign values/groups (parser-consistent)', () => {
    const ownership = new Map<number, number>([
      [116, 5],
      [200, 5],
      [91, 18],
    ]);

    // Fully foreign group ignored — must not remap to attribute 5.
    expect(
      sanitizeStorefrontPlpAttributeOwnership(
        [{ attributeId: 999999, valueIds: [116] }],
        ownership,
      ),
    ).toEqual([]);

    // Mixed foreign + owned: keep only owned values.
    expect(
      sanitizeStorefrontPlpAttributeOwnership(
        [
          { attributeId: 5, valueIds: [116, 999] },
          { attributeId: 999999, valueIds: [116] },
          { attributeId: 18, valueIds: [91] },
        ],
        ownership,
      ),
    ).toEqual([
      { attributeId: 5, valueIds: [116] },
      { attributeId: 18, valueIds: [91] },
    ]);
  });

  it('preserves OR-within / AND-across with ownership joins', () => {
    const clauses: Array<{ where: string; params?: Record<string, unknown> }> =
      [];
    const builder = {
      andWhere: (where: string, params?: Record<string, unknown>) => {
        clauses.push({ where, params });
        return builder;
      },
    };

    applyStorefrontPlpFilters(
      builder,
      {
        brandIds: [],
        minPrice: null,
        maxPrice: null,
        attributes: [
          { attributeId: 12, valueIds: [44, 45] },
          { attributeId: 18, valueIds: [91] },
        ],
      },
      1,
    );

    expect(clauses).toHaveLength(2);
    expect(clauses[0].params).toEqual({
      plpAttrId_12: 12,
      plpAttrVals_12: [44, 45],
    });
    expect(clauses[1].params).toEqual({
      plpAttrId_18: 18,
      plpAttrVals_18: [91],
    });
  });

  it('supports self-facet exclusion for brands / price / one attribute', () => {
    const clauses: string[] = [];
    const builder = {
      andWhere: (where: string) => {
        clauses.push(where);
        return builder;
      },
    };

    applyStorefrontPlpFilters(
      builder,
      {
        brandIds: [9],
        minPrice: 100,
        maxPrice: 200,
        attributes: [
          { attributeId: 12, valueIds: [1] },
          { attributeId: 18, valueIds: [2] },
        ],
      },
      1,
      { skipBrands: true, skipAttributeId: 12 },
    );

    expect(clauses.some((c) => c.includes('brandId'))).toBe(false);
    expect(
      clauses.some(
        (c) => c.includes('plpAttrVals_12') || c.includes(':...plpAttrVals_12'),
      ),
    ).toBe(false);
    // Price still applied; attribute 18 still applied.
    expect(
      clauses.some((c) => c.includes(STOREFRONT_EFFECTIVE_PRICE_SQL)),
    ).toBe(true);
    expect(clauses.length).toBeGreaterThanOrEqual(3);
  });

  it('converts toman ↔ TRY consistently with display rounding', () => {
    expect(tomanBoundsToTry(1000, 5000, 10)).toEqual({
      minTry: 100,
      maxTry: 500,
    });
    expect(tryPriceToToman(80.4, 10)).toBe(804);
    expect(tryPriceToToman(null, 10)).toBeNull();
  });
});
