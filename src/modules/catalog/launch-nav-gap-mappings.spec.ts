/**
 * Launch/release nav gaps must be reachable via active source_category_mapping
 * (+ gender slice routing when female/male rows are used).
 */
import { expandSourceCategoryIds } from './canonical-category-scope.resolver';
import {
  resolveCanonicalProductEligibility,
  type CanonicalEligibilityData,
} from './canonical-product-eligibility';
import { SourceCategoryMappingGenderSlice } from './entities/source-category-mapping.entity';
import { ProductGender } from '../product/entities/product.entity';

describe('launch nav gap mappings (81 / 217 / 346)', () => {
  it('includes sneakers leaf 81 when mapped directly to کفش ورزشی', () => {
    const expanded = expandSourceCategoryIds(
      [{ sourceCategoryId: 81, source: 'trendyol' }],
      [
        {
          id: 81,
          parentId: 80,
          source: 'trendyol',
          status: 'active',
          name: 'کفش کتانی',
        },
      ],
    );
    expect(expanded).toContain(81);
  });

  it('includes classic heels 217 when mapped directly (parent 703 is source-null)', () => {
    const expanded = expandSourceCategoryIds(
      [
        { sourceCategoryId: 215, source: 'trendyol' },
        { sourceCategoryId: 217, source: 'trendyol' },
      ],
      [
        {
          id: 215,
          parentId: 79,
          source: 'trendyol',
          status: 'active',
          name: 'کفش پاشنه بلند',
        },
        {
          id: 703,
          parentId: 2,
          source: null,
          status: 'active',
          name: 'کفش',
        },
        {
          id: 217,
          parentId: 703,
          source: 'trendyol',
          status: 'active',
          name: 'کفش پاشنه بلند کلاسیک',
        },
      ],
    );
    expect(
      expandSourceCategoryIds(
        [{ sourceCategoryId: 215, source: 'trendyol' }],
        [
          {
            id: 215,
            parentId: 79,
            source: 'trendyol',
            status: 'active',
            name: 'کفش پاشنه بلند',
          },
          {
            id: 703,
            parentId: 2,
            source: null,
            status: 'active',
            name: 'کفش',
          },
          {
            id: 217,
            parentId: 703,
            source: 'trendyol',
            status: 'active',
            name: 'کفش پاشنه بلند کلاسیک',
          },
        ],
      ),
    ).not.toContain(217);
    expect(expanded).toContain(217);
  });

  it('includes polo leaf 346 when mapped to تیشرت', () => {
    const expanded = expandSourceCategoryIds(
      [{ sourceCategoryId: 346, source: 'trendyol' }],
      [
        {
          id: 346,
          parentId: 2,
          source: 'trendyol',
          status: 'active',
          name: 'تیشرت یقه پولو',
        },
      ],
    );
    expect(expanded).toContain(346);
  });
});

describe('release nav gender-slice gaps (Jean / Külot)', () => {
  const canonicalRows = [
    { id: 1, parentId: null, status: 'active', name: 'زنانه' },
    { id: 2, parentId: 1, status: 'active', name: 'پوشاک' },
    { id: 21, parentId: 2, status: 'active', name: 'شلوار جین' },
    { id: 87, parentId: 2, status: 'active', name: 'لباس زیر' },
    { id: 6, parentId: null, status: 'active', name: 'مردانه' },
    { id: 7, parentId: 6, status: 'active', name: 'پوشاک' },
    { id: 41, parentId: 7, status: 'active', name: 'شلوار جین' },
  ];

  const sourceTaxonomy = [
    { id: 19, parentId: 2, source: 'trendyol', status: 'active', name: 'Jean' },
    { id: 11, parentId: 10, source: 'trendyol', status: 'active', name: 'Külot' },
  ];

  it('routes Jean female/male slices to women/men jeans when slice routing is on', () => {
    const data: CanonicalEligibilityData = {
      canonicalRows: canonicalRows as any,
      mappings: [
        {
          canonicalCategoryId: 21,
          sourceCategoryId: 19,
          status: 'active',
          source: 'trendyol',
          genderSlice: SourceCategoryMappingGenderSlice.female,
          reviewStatus: 'reviewed_ok',
        },
        {
          canonicalCategoryId: 41,
          sourceCategoryId: 19,
          status: 'active',
          source: 'trendyol',
          genderSlice: SourceCategoryMappingGenderSlice.male,
          reviewStatus: 'reviewed_ok',
        },
      ] as any,
      sourceTaxonomy: sourceTaxonomy as any,
    };

    const women = resolveCanonicalProductEligibility(21, data, {
      sliceRoutingEnabled: true,
    });
    expect(women.sourceCategoryIds).toContain(19);
    expect(women.clauses.some((c) => c.slice === 'female')).toBe(true);

    const men = resolveCanonicalProductEligibility(41, data, {
      sliceRoutingEnabled: true,
    });
    expect(men.sourceCategoryIds).toContain(19);
    expect(men.clauses.some((c) => c.slice === 'male')).toBe(true);
  });

  it('ignores female/male Jean rows when slice routing is off', () => {
    const data: CanonicalEligibilityData = {
      canonicalRows: canonicalRows as any,
      mappings: [
        {
          canonicalCategoryId: 21,
          sourceCategoryId: 19,
          status: 'active',
          source: 'trendyol',
          genderSlice: SourceCategoryMappingGenderSlice.female,
          reviewStatus: 'reviewed_ok',
        },
      ] as any,
      sourceTaxonomy: sourceTaxonomy as any,
    };
    const women = resolveCanonicalProductEligibility(21, data, {
      sliceRoutingEnabled: false,
    });
    expect(women.sourceCategoryIds).not.toContain(19);
  });

  it('routes Külot female into women underwear with slice routing', () => {
    const data: CanonicalEligibilityData = {
      canonicalRows: canonicalRows as any,
      mappings: [
        {
          canonicalCategoryId: 87,
          sourceCategoryId: 11,
          status: 'active',
          source: 'trendyol',
          genderSlice: SourceCategoryMappingGenderSlice.female,
          reviewStatus: 'reviewed_ok',
        },
      ] as any,
      sourceTaxonomy: sourceTaxonomy as any,
    };
    const elig = resolveCanonicalProductEligibility(87, data, {
      sliceRoutingEnabled: true,
    });
    expect(elig.sourceCategoryIds).toContain(11);
    const femaleClause = elig.clauses.find((c) => c.slice === 'female');
    expect(femaleClause?.genders).toEqual(
      expect.arrayContaining([ProductGender.female, ProductGender.unisex]),
    );
  });
});
