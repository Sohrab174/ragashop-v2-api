import {
  isEffectivePdpMappingRule,
  pickEffectiveMappingForPdpBreadcrumb,
  resolveNearestMappedCanonicalId,
  resolveNearestMappedCanonicalIdLegacyLastWriteWins,
  type PdpMappingRuleRow,
} from './storefront-pdp.mapping-resolve';
import {
  SourceCategoryMappingGenderSlice,
  SourceCategoryMappingReviewStatus,
  SourceCategoryMappingStatus,
} from './entities/source-category-mapping.entity';
import {
  buildCanonicalBreadcrumbTrail,
  compactBreadcrumbTrail,
} from './storefront-pdp.breadcrumb';

function row(
  partial: Partial<PdpMappingRuleRow> &
    Pick<PdpMappingRuleRow, 'id' | 'sourceCategoryId' | 'canonicalCategoryId'>,
): PdpMappingRuleRow {
  return {
    genderSlice: SourceCategoryMappingGenderSlice.any,
    reviewStatus: SourceCategoryMappingReviewStatus.legacy_unreviewed,
    status: SourceCategoryMappingStatus.active,
    ...partial,
  };
}

describe('storefront-pdp.mapping-resolve — effective rules (V2-B parity)', () => {
  it('treats any as always effective (legacy + reviewed)', () => {
    expect(
      isEffectivePdpMappingRule(
        row({
          id: 1,
          sourceCategoryId: 10,
          canonicalCategoryId: 100,
          genderSlice: 'any',
          reviewStatus: 'legacy_unreviewed',
        }),
        false,
      ),
    ).toBe(true);
    expect(
      isEffectivePdpMappingRule(
        row({
          id: 2,
          sourceCategoryId: 10,
          canonicalCategoryId: 100,
          genderSlice: 'any',
          reviewStatus: 'reviewed_ok',
        }),
        false,
      ),
    ).toBe(true);
  });

  it('gates female/male/unisex on flag + reviewStatus', () => {
    const femaleUnreviewed = row({
      id: 1,
      sourceCategoryId: 10,
      canonicalCategoryId: 200,
      genderSlice: 'female',
      reviewStatus: 'legacy_unreviewed',
    });
    const femaleReviewed = row({
      id: 2,
      sourceCategoryId: 10,
      canonicalCategoryId: 200,
      genderSlice: 'female',
      reviewStatus: 'reviewed_ok',
    });
    const femaleMigrated = row({
      id: 3,
      sourceCategoryId: 10,
      canonicalCategoryId: 200,
      genderSlice: 'female',
      reviewStatus: 'migrated',
    });

    expect(isEffectivePdpMappingRule(femaleUnreviewed, true)).toBe(false);
    expect(isEffectivePdpMappingRule(femaleReviewed, false)).toBe(false);
    expect(isEffectivePdpMappingRule(femaleReviewed, true)).toBe(true);
    expect(isEffectivePdpMappingRule(femaleMigrated, true)).toBe(true);
  });
});

describe('storefront-pdp.mapping-resolve — female/male fixtures', () => {
  const female = row({
    id: 1,
    sourceCategoryId: 50,
    canonicalCategoryId: 201,
    genderSlice: 'female',
    reviewStatus: 'reviewed_ok',
  });
  const male = row({
    id: 2,
    sourceCategoryId: 50,
    canonicalCategoryId: 301,
    genderSlice: 'male',
    reviewStatus: 'reviewed_ok',
  });

  it('female product → women destination; male never selected', () => {
    const picked = pickEffectiveMappingForPdpBreadcrumb('female', [male, female], {
      sliceRoutingEnabled: true,
    });
    expect(picked?.canonicalCategoryId).toBe(201);
  });

  it('male product → men destination; female never selected', () => {
    const picked = pickEffectiveMappingForPdpBreadcrumb('male', [female, male], {
      sliceRoutingEnabled: true,
    });
    expect(picked?.canonicalCategoryId).toBe(301);
  });

  it('query/order of mapping rows does not matter (no last-write-wins)', () => {
    const a = resolveNearestMappedCanonicalId(
      [50],
      [female, male],
      'female',
      { sliceRoutingEnabled: true },
    );
    const b = resolveNearestMappedCanonicalId(
      [50],
      [male, female],
      'female',
      { sliceRoutingEnabled: true },
    );
    expect(a).toBe(201);
    expect(b).toBe(201);

    const c = resolveNearestMappedCanonicalId(
      [50],
      [male, female],
      'male',
      { sliceRoutingEnabled: true },
    );
    const d = resolveNearestMappedCanonicalId(
      [50],
      [female, male],
      'male',
      { sliceRoutingEnabled: true },
    );
    expect(c).toBe(301);
    expect(d).toBe(301);
  });
});

describe('storefront-pdp.mapping-resolve — legacy any compatibility', () => {
  const anyLegacy = row({
    id: 9,
    sourceCategoryId: 60,
    canonicalCategoryId: 400,
    genderSlice: 'any',
    reviewStatus: 'legacy_unreviewed',
  });

  it('female/male/unisex/null all retain legacy breadcrumb with only any', () => {
    for (const gender of ['female', 'male', 'unisex', null] as const) {
      expect(
        pickEffectiveMappingForPdpBreadcrumb(gender, [anyLegacy], {
          sliceRoutingEnabled: true,
        })?.canonicalCategoryId,
      ).toBe(400);
      expect(
        pickEffectiveMappingForPdpBreadcrumb(gender, [anyLegacy], {
          sliceRoutingEnabled: false,
        })?.canonicalCategoryId,
      ).toBe(400);
    }
  });
});

describe('storefront-pdp.mapping-resolve — slice + any transition', () => {
  const anyRow = row({
    id: 1,
    sourceCategoryId: 70,
    canonicalCategoryId: 500,
    genderSlice: 'any',
    reviewStatus: 'legacy_unreviewed',
  });
  const femaleRow = row({
    id: 2,
    sourceCategoryId: 70,
    canonicalCategoryId: 501,
    genderSlice: 'female',
    reviewStatus: 'reviewed_ok',
  });

  it('female uses slice when effective; male/null fall back to any', () => {
    const rows = [anyRow, femaleRow];
    expect(
      pickEffectiveMappingForPdpBreadcrumb('female', rows, {
        sliceRoutingEnabled: true,
      })?.canonicalCategoryId,
    ).toBe(501);
    expect(
      pickEffectiveMappingForPdpBreadcrumb('male', rows, {
        sliceRoutingEnabled: true,
      })?.canonicalCategoryId,
    ).toBe(500);
    expect(
      pickEffectiveMappingForPdpBreadcrumb(null, rows, {
        sliceRoutingEnabled: true,
      })?.canonicalCategoryId,
    ).toBe(500);
    expect(
      pickEffectiveMappingForPdpBreadcrumb('unisex', rows, {
        sliceRoutingEnabled: true,
      })?.canonicalCategoryId,
    ).toBe(500);
  });

  it('unreviewed female slice does not override any even when flag ON', () => {
    const bad = row({
      id: 3,
      sourceCategoryId: 70,
      canonicalCategoryId: 999,
      genderSlice: 'female',
      reviewStatus: 'legacy_unreviewed',
    });
    expect(
      pickEffectiveMappingForPdpBreadcrumb('female', [anyRow, bad], {
        sliceRoutingEnabled: true,
      })?.canonicalCategoryId,
    ).toBe(500);
  });
});

describe('storefront-pdp.mapping-resolve — unisex vs discovery', () => {
  const female = row({
    id: 1,
    sourceCategoryId: 80,
    canonicalCategoryId: 601,
    genderSlice: 'female',
    reviewStatus: 'reviewed_ok',
  });
  const male = row({
    id: 2,
    sourceCategoryId: 80,
    canonicalCategoryId: 602,
    genderSlice: 'male',
    reviewStatus: 'reviewed_ok',
  });

  it('unisex with only female+male does NOT invent a side (no any)', () => {
    // Discovery may still show this product on both PLPs; PDP must not guess.
    expect(
      pickEffectiveMappingForPdpBreadcrumb('unisex', [female, male], {
        sliceRoutingEnabled: true,
      }),
    ).toBeNull();
    expect(
      resolveNearestMappedCanonicalId([80], [female, male], 'unisex', {
        sliceRoutingEnabled: true,
      }),
    ).toBeNull();
  });

  it('explicit unisex slice wins when effective', () => {
    const unisex = row({
      id: 3,
      sourceCategoryId: 80,
      canonicalCategoryId: 603,
      genderSlice: 'unisex',
      reviewStatus: 'reviewed_ok',
    });
    expect(
      pickEffectiveMappingForPdpBreadcrumb('unisex', [female, male, unisex], {
        sliceRoutingEnabled: true,
      })?.canonicalCategoryId,
    ).toBe(603);
  });

  it('any wins for unisex when no explicit unisex slice', () => {
    const anyRow = row({
      id: 4,
      sourceCategoryId: 80,
      canonicalCategoryId: 604,
      genderSlice: 'any',
      reviewStatus: 'legacy_unreviewed',
    });
    expect(
      pickEffectiveMappingForPdpBreadcrumb('unisex', [female, male, anyRow], {
        sliceRoutingEnabled: true,
      })?.canonicalCategoryId,
    ).toBe(604);
  });
});

describe('storefront-pdp.mapping-resolve — null gender', () => {
  it('selects neither female nor male without any', () => {
    const female = row({
      id: 1,
      sourceCategoryId: 90,
      canonicalCategoryId: 701,
      genderSlice: 'female',
      reviewStatus: 'reviewed_ok',
    });
    const male = row({
      id: 2,
      sourceCategoryId: 90,
      canonicalCategoryId: 702,
      genderSlice: 'male',
      reviewStatus: 'reviewed_ok',
    });
    expect(
      pickEffectiveMappingForPdpBreadcrumb(null, [female, male], {
        sliceRoutingEnabled: true,
      }),
    ).toBeNull();
  });

  it('falls back to any when present', () => {
    const anyRow = row({
      id: 3,
      sourceCategoryId: 90,
      canonicalCategoryId: 700,
      genderSlice: 'any',
      reviewStatus: 'reviewed_ok',
    });
    const female = row({
      id: 1,
      sourceCategoryId: 90,
      canonicalCategoryId: 701,
      genderSlice: 'female',
      reviewStatus: 'reviewed_ok',
    });
    expect(
      pickEffectiveMappingForPdpBreadcrumb(null, [female, anyRow], {
        sliceRoutingEnabled: true,
      })?.canonicalCategoryId,
    ).toBe(700);
  });
});

describe('storefront-pdp.mapping-resolve — ancestors + provider isolation surface', () => {
  it('prefers nearest mapped ancestor after gender filter', () => {
    const leafFemale = row({
      id: 1,
      sourceCategoryId: 11,
      canonicalCategoryId: 801,
      genderSlice: 'female',
      reviewStatus: 'reviewed_ok',
    });
    const parentAny = row({
      id: 2,
      sourceCategoryId: 10,
      canonicalCategoryId: 800,
      genderSlice: 'any',
      reviewStatus: 'legacy_unreviewed',
    });
    // leaf→root
    expect(
      resolveNearestMappedCanonicalId(
        [11, 10],
        [parentAny, leafFemale],
        'female',
        { sliceRoutingEnabled: true },
      ),
    ).toBe(801);
    // male ignores leaf female, uses parent any
    expect(
      resolveNearestMappedCanonicalId(
        [11, 10],
        [leafFemale, parentAny],
        'male',
        { sliceRoutingEnabled: true },
      ),
    ).toBe(800);
  });

  it('opposite slice at ancestor cannot leak into female product', () => {
    const parentMale = row({
      id: 1,
      sourceCategoryId: 10,
      canonicalCategoryId: 901,
      genderSlice: 'male',
      reviewStatus: 'reviewed_ok',
    });
    expect(
      resolveNearestMappedCanonicalId([11, 10], [parentMale], 'female', {
        sliceRoutingEnabled: true,
      }),
    ).toBeNull();
  });
});

describe('storefront-pdp.mapping-resolve — public breadcrumb shape compatibility', () => {
  it('resolved canonical id still produces {id,name}[] trail', () => {
    const byId = new Map([
      [201, { id: 201, parentId: 20, name: 'تیشرت', status: 'active' }],
      [20, { id: 20, parentId: 2, name: 'پوشاک', status: 'active' }],
      [2, { id: 2, parentId: null, name: 'زنانه', status: 'active' }],
    ]);
    const trail = compactBreadcrumbTrail(
      buildCanonicalBreadcrumbTrail(201, byId),
      3,
    );
    expect(trail).toEqual([
      { id: 2, name: 'زنانه' },
      { id: 20, name: 'پوشاک' },
      { id: 201, name: 'تیشرت' },
    ]);
  });
});

describe('storefront-pdp.mapping-resolve — legacy last-write-wins defect documented', () => {
  it('old Map collapse flips with row order; new resolver does not', () => {
    const female = row({
      id: 1,
      sourceCategoryId: 50,
      canonicalCategoryId: 201,
      genderSlice: 'female',
      reviewStatus: 'reviewed_ok',
    });
    const male = row({
      id: 2,
      sourceCategoryId: 50,
      canonicalCategoryId: 301,
      genderSlice: 'male',
      reviewStatus: 'reviewed_ok',
    });
    const oldA = resolveNearestMappedCanonicalIdLegacyLastWriteWins(
      [50],
      [female, male],
    );
    const oldB = resolveNearestMappedCanonicalIdLegacyLastWriteWins(
      [50],
      [male, female],
    );
    expect(oldA).toBe(301); // last write
    expect(oldB).toBe(201); // last write flipped
    expect(oldA).not.toBe(oldB);

    const newA = resolveNearestMappedCanonicalId([50], [female, male], 'female', {
      sliceRoutingEnabled: true,
    });
    const newB = resolveNearestMappedCanonicalId([50], [male, female], 'female', {
      sliceRoutingEnabled: true,
    });
    expect(newA).toBe(201);
    expect(newB).toBe(201);
  });
});
