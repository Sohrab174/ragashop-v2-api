import { ProductGender } from '../product/entities/product.entity';
import { eligibleProductGendersForAudience } from './canonical-audience-policy';
import { resolveCanonicalCategoryScope } from './canonical-category-scope.resolver';
import {
  applyCanonicalProductEligibility,
  buildCanonicalEligibilityClauseSql,
  CanonicalEligibilityData,
  canonicalEligibilityCacheSuffix,
  CATALOG_MAPPING_V2_ENV,
  EligibilityMappingRow,
  isCatalogMappingV2SliceRoutingEnabled,
  isProductCanonicallyEligible,
  resolveCanonicalProductEligibility,
} from './canonical-product-eligibility';

/**
 * Fixture taxonomy
 *   canonical: 1 زنانه(female) → 2 → 20 tshirt
 *              6 مردانه(male)  → 7 → 40 tshirt
 *              11 بچگانه(child) → 12
 *              14 زیبایی(neutral) → 56
 *              16 لایف‌استایل(neutral) → 65
 *   source (trendyol): 100 T-Shirt → 101 Oversize; 200 Kozmetik → 201; 500 Kids
 *   source (other):    300 child of 100 (cross-provider link); 400 "T-Shirt" root
 */
const canonicalRows = [
  {
    id: 1,
    parentId: null,
    status: 'active',
    name: 'زنانه',
    audience: 'female',
  },
  { id: 2, parentId: 1, status: 'active', name: 'پوشاک', audience: null },
  { id: 20, parentId: 2, status: 'active', name: 'تی‌شرت', audience: null },
  { id: 6, parentId: null, status: 'active', name: 'مردانه', audience: 'male' },
  { id: 7, parentId: 6, status: 'active', name: 'پوشاک', audience: null },
  { id: 40, parentId: 7, status: 'active', name: 'تی‌شرت', audience: null },
  {
    id: 11,
    parentId: null,
    status: 'active',
    name: 'بچگانه',
    audience: 'child',
  },
  { id: 12, parentId: 11, status: 'active', name: 'پوشاک', audience: null },
  { id: 14, parentId: null, status: 'active', name: 'زیبایی', audience: null },
  {
    id: 56,
    parentId: 14,
    status: 'active',
    name: 'مراقبت پوست',
    audience: null,
  },
  {
    id: 16,
    parentId: null,
    status: 'active',
    name: 'لایف‌استایل',
    audience: null,
  },
  { id: 65, parentId: 16, status: 'active', name: 'تی‌شرت', audience: null },
];

const sourceTaxonomy = [
  {
    id: 100,
    parentId: null,
    source: 'trendyol',
    status: 'active',
    name: 'T-Shirt',
  },
  {
    id: 101,
    parentId: 100,
    source: 'trendyol',
    status: 'active',
    name: 'Oversize',
  },
  {
    id: 200,
    parentId: null,
    source: 'trendyol',
    status: 'active',
    name: 'Kozmetik',
  },
  {
    id: 201,
    parentId: 200,
    source: 'trendyol',
    status: 'active',
    name: 'Cilt',
  },
  {
    id: 500,
    parentId: null,
    source: 'trendyol',
    status: 'active',
    name: 'Kids',
  },
  {
    id: 300,
    parentId: 100,
    source: 'other',
    status: 'active',
    name: 'T-Shirt',
  },
  {
    id: 400,
    parentId: null,
    source: 'other',
    status: 'active',
    name: 'T-Shirt',
  },
];

type P = { id: number; categoryId: number; gender: ProductGender | null };
const products: P[] = [
  { id: 1, categoryId: 100, gender: ProductGender.female },
  { id: 2, categoryId: 100, gender: ProductGender.male },
  { id: 3, categoryId: 100, gender: ProductGender.unisex },
  { id: 4, categoryId: 100, gender: null },
  { id: 5, categoryId: 101, gender: ProductGender.female },
  { id: 6, categoryId: 101, gender: ProductGender.male },
  { id: 7, categoryId: 300, gender: ProductGender.female },
  { id: 8, categoryId: 400, gender: ProductGender.female },
  { id: 9, categoryId: 200, gender: ProductGender.female },
  { id: 10, categoryId: 200, gender: ProductGender.male },
  { id: 11, categoryId: 201, gender: ProductGender.unisex },
  { id: 12, categoryId: 201, gender: null },
  { id: 13, categoryId: 500, gender: null },
  { id: 14, categoryId: 500, gender: ProductGender.female },
  { id: 15, categoryId: 500, gender: ProductGender.male },
];

let nextId = 1;
function mapping(
  sourceCategoryId: number,
  canonicalCategoryId: number,
  genderSlice: string,
  reviewStatus: string,
  extra?: Partial<EligibilityMappingRow>,
): EligibilityMappingRow {
  return {
    id: nextId++,
    sourceCategoryId,
    canonicalCategoryId,
    genderSlice,
    reviewStatus,
    status: 'active',
    source: 'trendyol',
    ...extra,
  };
}

function data(mappings: EligibilityMappingRow[]): CanonicalEligibilityData {
  return { canonicalRows, mappings, sourceTaxonomy };
}

function eligibleIds(
  canonicalId: number,
  mappings: EligibilityMappingRow[],
  sliceRoutingEnabled = true,
): number[] {
  const eligibility = resolveCanonicalProductEligibility(
    canonicalId,
    data(mappings),
    { sliceRoutingEnabled },
  );
  return products
    .filter((p) => isProductCanonicallyEligible(p, eligibility))
    .map((p) => p.id);
}

describe('CAT-MAP-V2-B mixed source with reviewed female/male slices', () => {
  const mappings = [
    mapping(100, 20, 'female', 'reviewed_ok'),
    mapping(100, 40, 'male', 'reviewed_ok'),
  ];

  it('women branch admits female + unisex, never male or null', () => {
    expect(eligibleIds(1, mappings)).toEqual([1, 3, 5]);
    expect(eligibleIds(20, mappings)).toEqual([1, 3, 5]);
  });

  it('men branch admits male + unisex, never female or null', () => {
    expect(eligibleIds(6, mappings)).toEqual([2, 3, 6]);
    expect(eligibleIds(40, mappings)).toEqual([2, 3, 6]);
  });

  it('the same unisex product is eligible in both branches', () => {
    expect(eligibleIds(20, mappings)).toContain(3);
    expect(eligibleIds(40, mappings)).toContain(3);
  });

  it('builds one female clause with female+unisex genders', () => {
    const e = resolveCanonicalProductEligibility(20, data(mappings), {
      sliceRoutingEnabled: true,
    });
    expect(e.clauses).toEqual([
      {
        slice: 'female',
        sourceCategoryIds: [100, 101],
        genders: [ProductGender.female, ProductGender.unisex],
      },
    ]);
    expect(e.audienceGenders).toEqual([
      ProductGender.female,
      ProductGender.unisex,
    ]);
    expect(e.diagnostics.routedSliceMappings).toBe(1);
  });

  it('explicit unisex slice admits only unisex', () => {
    const m = [mapping(200, 65, 'unisex', 'reviewed_ok')];
    expect(eligibleIds(16, m)).toEqual([11]);
  });
});

describe('CAT-MAP-V2-B rollout / fail-closed slice gating', () => {
  const mappings = [
    mapping(100, 20, 'female', 'reviewed_ok'),
    mapping(100, 40, 'male', 'reviewed_ok'),
  ];

  it('slice rows do not route when CATALOG_MAPPING_V2 is off', () => {
    const e = resolveCanonicalProductEligibility(20, data(mappings), {
      sliceRoutingEnabled: false,
    });
    expect(e.sourceCategoryIds).toEqual([]);
    expect(e.diagnostics.ignoredSliceMappings).toBe(1);
  });

  it('unreviewed slice rows never route even when enabled', () => {
    for (const review of ['legacy_unreviewed', 'needs_review']) {
      const m = [mapping(100, 20, 'female', review)];
      expect(eligibleIds(20, m, true)).toEqual([]);
    }
  });

  it('migrated slice rows route', () => {
    expect(eligibleIds(20, [mapping(100, 20, 'female', 'migrated')])).toEqual([
      1, 3, 5,
    ]);
  });

  it('unknown slice values are ignored (no unknown→adult routing)', () => {
    expect(
      eligibleIds(20, [mapping(100, 20, 'unknown', 'reviewed_ok')]),
    ).toEqual([]);
  });

  it('flag defaults off and only "1" enables it', () => {
    const prev = process.env[CATALOG_MAPPING_V2_ENV];
    try {
      delete process.env[CATALOG_MAPPING_V2_ENV];
      expect(isCatalogMappingV2SliceRoutingEnabled()).toBe(false);
      process.env[CATALOG_MAPPING_V2_ENV] = 'true';
      expect(isCatalogMappingV2SliceRoutingEnabled()).toBe(false);
      process.env[CATALOG_MAPPING_V2_ENV] = '1';
      expect(isCatalogMappingV2SliceRoutingEnabled()).toBe(true);
    } finally {
      if (prev == null) delete process.env[CATALOG_MAPPING_V2_ENV];
      else process.env[CATALOG_MAPPING_V2_ENV] = prev;
    }
  });
});

describe('CAT-MAP-V2-B legacy any compatibility', () => {
  const legacy = [mapping(100, 20, 'any', 'legacy_unreviewed')];

  it('structural scope is exactly the V1 resolver output', () => {
    for (const enabled of [false, true]) {
      const e = resolveCanonicalProductEligibility(1, data(legacy), {
        sliceRoutingEnabled: enabled,
      });
      const v1 = resolveCanonicalCategoryScope(
        1,
        canonicalRows,
        legacy,
        sourceTaxonomy,
      );
      expect(e.sourceCategoryIds).toEqual(v1.sourceCategoryIds);
      expect(e.canonicalCategoryIds).toEqual(v1.canonicalCategoryIds);
      expect(e.clauses).toEqual([
        { slice: 'any', sourceCategoryIds: [100, 101], genders: null },
      ]);
    }
  });

  it('CAT-3B then yields female + unisex (not male, not null)', () => {
    expect(eligibleIds(1, legacy)).toEqual([1, 3, 5]);
    expect(eligibleIds(20, legacy)).toEqual([1, 3, 5]);
  });

  it('legacy men mapping is not reinterpreted as a male slice', () => {
    const men = [mapping(100, 40, 'any', 'legacy_unreviewed')];
    const e = resolveCanonicalProductEligibility(6, data(men), {
      sliceRoutingEnabled: true,
    });
    expect(e.clauses).toEqual([
      { slice: 'any', sourceCategoryIds: [100, 101], genders: null },
    ]);
    expect(e.audienceGenders).toEqual(eligibleProductGendersForAudience('men'));
    expect(e.diagnostics.legacyAnyMappings).toBe(1);
    expect(eligibleIds(6, men)).toEqual([2, 3, 6]);
  });

  it('null genderSlice (pre-V2 rows) is treated as legacy any', () => {
    const m = [
      mapping(100, 20, null as unknown as string, null as unknown as string),
    ];
    expect(eligibleIds(1, m)).toEqual([1, 3, 5]);
  });

  it('inactive / out-of-scope legacy rows are excluded as in V1', () => {
    const m = [
      mapping(100, 20, 'any', 'legacy_unreviewed', { status: 'inactive' }),
      mapping(200, 56, 'any', 'legacy_unreviewed'),
    ];
    expect(eligibleIds(1, m)).toEqual([]);
  });
});

describe('CAT-MAP-V2-B neutral and kids roots', () => {
  it('neutral root + reviewed any admits every gender incl. null', () => {
    const m = [mapping(200, 56, 'any', 'reviewed_ok')];
    const e = resolveCanonicalProductEligibility(14, data(m), {
      sliceRoutingEnabled: true,
    });
    expect(e.audience).toBe('neutral');
    expect(e.audienceGenders).toBeNull();
    expect(e.diagnostics.reviewedAnyMappings).toBe(1);
    expect(eligibleIds(14, m)).toEqual([9, 10, 11, 12]);
  });

  it('neutral root still respects an explicit female slice', () => {
    const m = [mapping(200, 56, 'female', 'reviewed_ok')];
    expect(eligibleIds(14, m)).toEqual([9, 11]);
  });

  it('kids root stays structural (no adult CAT-3B, null kept)', () => {
    const m = [mapping(500, 12, 'any', 'legacy_unreviewed')];
    const e = resolveCanonicalProductEligibility(11, data(m), {
      sliceRoutingEnabled: true,
    });
    expect(e.audience).toBe('kids');
    expect(e.audienceGenders).toBeNull();
    expect(eligibleIds(11, m)).toEqual([13, 14, 15]);
  });
});

describe('CAT-MAP-V2-B descendants and provider isolation', () => {
  it('canonical parent includes mappings on canonical descendants', () => {
    const m = [mapping(100, 20, 'any', 'legacy_unreviewed')];
    expect(eligibleIds(1, m)).toEqual(eligibleIds(20, m));
    expect(eligibleIds(2, m)).toEqual([1, 3, 5]);
  });

  it('includes same-provider source descendants', () => {
    const e = resolveCanonicalProductEligibility(
      20,
      data([mapping(100, 20, 'female', 'reviewed_ok')]),
      { sliceRoutingEnabled: true },
    );
    expect(e.sourceCategoryIds).toContain(101);
  });

  it('cross-provider children / same-name roots never leak', () => {
    for (const m of [
      [mapping(100, 20, 'any', 'legacy_unreviewed')],
      [mapping(100, 20, 'female', 'reviewed_ok')],
    ]) {
      const e = resolveCanonicalProductEligibility(20, data(m), {
        sliceRoutingEnabled: true,
      });
      expect(e.sourceCategoryIds).not.toContain(300);
      expect(e.sourceCategoryIds).not.toContain(400);
      expect(eligibleIds(20, m)).not.toContain(7);
      expect(eligibleIds(20, m)).not.toContain(8);
    }
  });
});

describe('CAT-MAP-V2-B multiple rules / dedup', () => {
  it('unisex qualifying via female + male + unisex slices appears once', () => {
    const m = [
      mapping(100, 65, 'female', 'reviewed_ok'),
      mapping(100, 65, 'male', 'reviewed_ok'),
      mapping(100, 65, 'unisex', 'reviewed_ok'),
    ];
    const e = resolveCanonicalProductEligibility(16, data(m), {
      sliceRoutingEnabled: true,
    });
    expect(e.clauses.map((c) => c.slice)).toEqual(['female', 'male']);
    const ids = eligibleIds(16, m);
    expect(ids).toEqual([1, 2, 3, 5, 6]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(e.sourceCategoryIds).toEqual([100, 101]);
  });

  it('any supersedes narrower slices for the same source category', () => {
    const m = [
      mapping(101, 20, 'any', 'legacy_unreviewed'),
      mapping(100, 20, 'female', 'reviewed_ok'),
    ];
    const e = resolveCanonicalProductEligibility(20, data(m), {
      sliceRoutingEnabled: true,
    });
    expect(e.clauses).toEqual([
      { slice: 'any', sourceCategoryIds: [101], genders: null },
      {
        slice: 'female',
        sourceCategoryIds: [100],
        genders: [ProductGender.female, ProductGender.unisex],
      },
    ]);
    const all = e.clauses.flatMap((c) => c.sourceCategoryIds);
    expect(new Set(all).size).toBe(all.length);
    expect(eligibleIds(20, m)).toEqual([1, 3, 5]);
  });
});

describe('CAT-MAP-V2-B SQL predicate', () => {
  it('legacy-only scope collapses to a single categoryId IN', () => {
    const sql = buildCanonicalEligibilityClauseSql(
      'product',
      {
        clauses: [
          { slice: 'any' as any, sourceCategoryIds: [100, 101], genders: null },
        ],
      },
      'p',
    );
    expect(sql).toEqual({
      sql: 'product.categoryId IN (:...pCat0)',
      params: { pCat0: [100, 101] },
    });
  });

  it('slice clauses are OR-ed with per-clause gender predicates', () => {
    const e = resolveCanonicalProductEligibility(
      20,
      data([
        mapping(101, 20, 'any', 'legacy_unreviewed'),
        mapping(100, 20, 'female', 'reviewed_ok'),
      ]),
      { sliceRoutingEnabled: true },
    );
    const sql = buildCanonicalEligibilityClauseSql('product', e, 'p');
    expect(sql?.sql).toBe(
      '(product.categoryId IN (:...pCat0) OR (product.categoryId IN (:...pCat1) AND product.gender IN (:...pGender1)))',
    );
    expect(sql?.params).toEqual({
      pCat0: [101],
      pCat1: [100],
      pGender1: ['female', 'unisex'],
    });
    expect(sql?.sql).not.toMatch(/JOIN/i);
  });

  function recorder() {
    const calls: Array<{ sql: string; params?: Record<string, unknown> }> = [];
    const qb: any = {
      andWhere: (sql: string, params?: Record<string, unknown>) => {
        calls.push({ sql, params });
        return qb;
      },
    };
    return { qb, calls };
  }

  it('applies CAT-3B audience predicate for adult roots only', () => {
    const legacy = [
      mapping(100, 20, 'any', 'legacy_unreviewed'),
      mapping(200, 56, 'any', 'reviewed_ok'),
    ];
    const women = recorder();
    applyCanonicalProductEligibility(
      women.qb,
      'product',
      resolveCanonicalProductEligibility(1, data(legacy)),
      'x',
    );
    expect(women.calls).toEqual([
      {
        sql: 'product.categoryId IN (:...xCat0)',
        params: { xCat0: [100, 101] },
      },
      {
        sql: 'product.gender IN (:...xAudience)',
        params: { xAudience: ['female', 'unisex'] },
      },
    ]);

    const neutral = recorder();
    applyCanonicalProductEligibility(
      neutral.qb,
      'product',
      resolveCanonicalProductEligibility(14, data(legacy)),
      'x',
    );
    expect(neutral.calls).toHaveLength(1);
    expect(neutral.calls[0].sql).not.toContain('gender');
  });

  it('empty eligibility matches nothing', () => {
    const r = recorder();
    applyCanonicalProductEligibility(
      r.qb,
      'product',
      resolveCanonicalProductEligibility(1, data([])),
      'x',
    );
    expect(r.calls).toEqual([{ sql: '1 = 0', params: undefined }]);
  });

  it('facet cache suffix is empty for V1-shaped scopes', () => {
    const legacy = resolveCanonicalProductEligibility(
      1,
      data([mapping(100, 20, 'any', 'legacy_unreviewed')]),
    );
    expect(canonicalEligibilityCacheSuffix(legacy)).toBe('');
    const sliced = resolveCanonicalProductEligibility(
      20,
      data([mapping(100, 20, 'female', 'reviewed_ok')]),
      { sliceRoutingEnabled: true },
    );
    expect(canonicalEligibilityCacheSuffix(sliced)).toBe('female:100,101');
  });
});
