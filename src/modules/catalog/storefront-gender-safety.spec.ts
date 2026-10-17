import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { SourceCategoryMappingGenderSlice } from './entities/source-category-mapping.entity';
import { evaluateAssortmentCommerceGate } from './assortment-policy/assortment-enforcement';
import { PageService } from '../page/page.service';
import { ProductService } from '../product/product.service';
import { SearchService } from '../search/search.service';
import { parseStorefrontSearchQuery } from '../search/storefront-search.query';
import { parseStorefrontSuggestionQuery } from '../search/storefront-suggestion.query';
import {
  applyAdultListingKidsExclusion,
  clearStorefrontGenderSafetyCache,
  homepageSectionProductGenderSql,
  legacyListingGenderPredicate,
  loadStorefrontGenderSafetySnapshot,
  splitEqualityGenderFilter,
} from './storefront-gender-safety';

type Where = { sql: string; params?: Record<string, unknown> };

function recordingQb() {
  const wheres: Where[] = [];
  const joins: unknown[][] = [];
  const overrides: Record<string, unknown> = {};
  const qb: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === 'string' && prop in overrides) return overrides[prop];
        if (prop === 'then') return undefined;
        if (prop === 'andWhere' || prop === 'where') {
          return (sql: unknown, params?: Record<string, unknown>) => {
            wheres.push({ sql: String(sql), params });
            return qb;
          };
        }
        if (
          prop === 'leftJoin' ||
          prop === 'leftJoinAndSelect' ||
          prop === 'innerJoin' ||
          prop === 'innerJoinAndSelect'
        ) {
          return (...args: unknown[]) => {
            joins.push(args);
            return qb;
          };
        }
        if (prop === 'getManyAndCount') return async () => [[], 0];
        if (prop === 'getRawMany' || prop === 'getMany') return async () => [];
        if (prop === 'getRawOne') return async () => ({ minPrice: 0, maxPrice: 0 });
        if (prop === 'getOne') return async () => null;
        return () => qb;
      },
      set(_target, prop, value) {
        overrides[String(prop)] = value;
        return true;
      },
    },
  );
  return { qb, wheres, joins };
}

const categories = [
  { id: 10, hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker', gender: null },
  { id: 20, hierarchy: 'Elektronik/Telefon', gender: null },
  { id: 30, hierarchy: 'Giyim/Üst Giyim/T-Shirt', gender: null },
];

const products = [
  {
    id: 101,
    categoryId: 10,
    gender: null,
    name: 'Runfalcon',
    sourceName: 'Runfalcon',
    ageGroup: 'adult',
  },
  {
    id: 102,
    categoryId: 10,
    gender: null,
    name: 'Adult Runner',
    sourceName: 'Adult Runner',
    ageGroup: null,
  },
  {
    id: 103,
    categoryId: 10,
    gender: 'female',
    name: 'Cırtlı Çocuk Ayakkabı',
    sourceName: 'Cırtlı Çocuk Ayakkabı Unisex Çocuk Sneaker',
    ageGroup: null,
  },
  {
    id: 105,
    categoryId: 30,
    gender: null,
    name: 'Çocuk tişört',
    sourceName: 'Erkek Çocuk Penye Polo Yaka T-shirt',
    ageGroup: null,
  },
  {
    id: 106,
    categoryId: 30,
    gender: null,
    name: 'Basic',
    sourceName: 'Basic T-shirt',
    ageGroup: null,
  },
];

const attributes = [
  { productId: 101, name: 'Beden', sourceName: 'Beden', kind: 'other', value: '28', valueSource: '28' },
  { productId: 101, name: 'Beden', sourceName: 'Beden', kind: 'other', value: '32', valueSource: '32' },
  { productId: 102, name: 'Beden', sourceName: 'Beden', kind: 'other', value: '40', valueSource: '40' },
  { productId: 102, name: 'Beden', sourceName: 'Beden', kind: 'other', value: '42', valueSource: '42' },
];

function fixtureQuery(sql: string) {
  if (sql.includes('category_assortment_resolution')) return [];
  if (sql.includes('FROM category')) return categories;
  if (sql.includes('FROM product p')) return products;
  if (sql.includes('product_attribute_value')) return attributes;
  return [];
}

function productServiceWith(qb: unknown) {
  return new ProductService(
    { createQueryBuilder: () => qb } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { getTryToToman: async () => 1 } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

function womenEligibility() {
  return {
    audience: 'women' as const,
    audienceGenders: ['female', 'unisex'] as const,
    selectedCanonicalId: 1,
    canonicalCategoryIds: [1],
    sourceCategoryIds: [10],
    clauses: [
      {
        slice: SourceCategoryMappingGenderSlice.any,
        sourceCategoryIds: [10],
        genders: null,
      },
    ],
    diagnostics: {
      legacyAnyMappings: 1,
      reviewedAnyMappings: 0,
      routedSliceMappings: 0,
      ignoredSliceMappings: 0,
    },
  };
}

describe('storefront gender safety', () => {
  beforeEach(() => clearStorefrontGenderSafetyCache());

  it('runs one snapshot when catalog reads overlap', async () => {
    let categoryQueries = 0;
    const query = async (sql: string) => {
      if (sql.includes('FROM category') && !sql.includes('assortment')) {
        categoryQueries += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      return fixtureQuery(sql);
    };
    const [first, second] = await Promise.all([
      loadStorefrontGenderSafetySnapshot({ query }),
      loadStorefrontGenderSafetySnapshot({ query }),
    ]);
    expect(categoryQueries).toBe(1);
    expect(second.kidsExclusionProductIds).toEqual(first.kidsExclusionProductIds);
  });

  it('classifies kids shoes and apparel with the existing classifier', async () => {
    const snapshot = await loadStorefrontGenderSafetySnapshot({
      query: async (sql: string) => fixtureQuery(sql),
    });

    expect(snapshot.reviewableCategoryIds).toEqual([10, 30]);
    expect(snapshot.kidsExclusionProductIds).toEqual([101, 103, 105]);
    expect(snapshot.neutralExceptionProductIds).toEqual([101, 105]);
    expect(snapshot.neutralExceptionProductIds).not.toContain(102);
    expect(snapshot.neutralExceptionProductIds).not.toContain(103);
    expect(snapshot.neutralExceptionProductIds).not.toContain(106);
  });

  it('keeps a gendered kids shoe off women listings and on kids listings', () => {
    const listing = recordingQb();
    const service = new CatalogService(
      {} as any,
      {} as any,
      { createQueryBuilder: () => listing.qb } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    (service as any)._buildEligibleProductBuilder(womenEligibility(), [103, 105]);
    expect(listing.wheres.some((w) => w.sql.includes('adultKidsExclusionIds'))).toBe(
      true,
    );
    expect(
      listing.wheres.find((w) => w.sql.includes('adultKidsExclusionIds'))?.params
        ?.adultKidsExclusionIds,
    ).toEqual([103, 105]);

    const kids = recordingQb();
    const kidsService = new CatalogService(
      {} as any,
      {} as any,
      { createQueryBuilder: () => kids.qb } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    (kidsService as any)._buildEligibleProductBuilder(
      { ...womenEligibility(), audience: 'kids', audienceGenders: null },
      [103, 105],
    );
    expect(kids.wheres.some((w) => w.sql.includes('adultKidsExclusionIds'))).toBe(
      false,
    );
    expect(kids.wheres.some((w) => String(w.sql).includes('product.gender'))).toBe(
      false,
    );
  });

  it('hides unresolved gender from global search and suggestions, and keeps neutral products', async () => {
    const listing = recordingQb();
    const service = new SearchService(
      {
        createQueryBuilder: () => listing.qb,
        manager: { query: async (sql: string) => fixtureQuery(sql) },
      } as any,
      { createQueryBuilder: () => recordingQb().qb } as any,
      { createQueryBuilder: () => recordingQb().qb } as any,
      { manager: { find: async () => [] } } as any,
      { getTryToToman: async () => 1 } as any,
    );
    const parsed = parseStorefrontSearchQuery({ q: 'ayakkabi' });
    if (parsed.ok === false) throw new Error(parsed.error.message);
    await service.searchCatalog(parsed.value);

    const unresolved = listing.wheres.find((w) =>
      w.sql.includes('unresolvedReviewableCategoryIds'),
    );
    expect(unresolved?.params?.unresolvedReviewableCategoryIds).toEqual([10, 30]);
    expect(unresolved?.params?.unresolvedNeutralProductIds).toEqual([101, 105]);
    expect(listing.wheres.some((w) => w.sql.includes('adultKidsExclusionIds'))).toBe(
      false,
    );

    const suggestions = recordingQb();
    const suggestionService = new SearchService(
      {
        createQueryBuilder: () => suggestions.qb,
        manager: { query: async (sql: string) => fixtureQuery(sql) },
      } as any,
      { createQueryBuilder: () => recordingQb().qb } as any,
      { createQueryBuilder: () => recordingQb().qb } as any,
      { find: async () => [], manager: { find: async () => [] } } as any,
      { getTryToToman: async () => 1 } as any,
    );
    const suggestionQuery = parseStorefrontSuggestionQuery({ q: 'aya' });
    if (suggestionQuery.ok === false) throw new Error('suggestion query');
    await suggestionService.getSuggestions(suggestionQuery.value);
    expect(
      suggestions.wheres.some((w) =>
        w.sql.includes('unresolvedReviewableCategoryIds'),
      ),
    ).toBe(true);
  });

  it('does not add a gender predicate to a gender-neutral category search', () => {
    const qb = recordingQb();
    applyAdultListingKidsExclusion(
      qb.qb,
      'product',
      { audience: 'neutral', audienceGenders: null },
      [101],
    );
    expect(qb.wheres).toEqual([]);
  });

  it('respects homepage section gender and leaves neutral and child sections open', () => {
    const sql = homepageSectionProductGenderSql('sections', 'product');
    expect(sql).toContain('sections.productGender IS NULL');
    expect(sql).toContain("sections.productGender = 'child'");
    expect(sql).toContain("product.gender IN ('female', 'unisex')");
    expect(sql).toContain("product.gender IN ('male', 'unisex')");
    expect(sql).toContain("product.gender IN ('unisex')");

    expect(legacyListingGenderPredicate('product', null)).toBeNull();
    expect(legacyListingGenderPredicate('product', 'child')).toBeNull();
    expect(legacyListingGenderPredicate('product', 'female')?.params).toEqual({
      sectionGenders: ['female', 'unisex'],
    });
    expect(legacyListingGenderPredicate('product', 'male')?.params).toEqual({
      sectionGenders: ['male', 'unisex'],
    });
    expect(legacyListingGenderPredicate('product', 'unisex')?.params).toEqual({
      sectionGenders: ['unisex'],
    });

    const split = splitEqualityGenderFilter([
      {
        logicalOperator: 'and',
        data: [{ field: 'gender', comparisonOperator: '=', value: 'female' }],
      },
      {
        logicalOperator: 'and',
        data: [{ field: 'brandId', comparisonOperator: '=', value: 4 }],
      },
    ]);
    expect(split.gender).toBe('female');
    expect(split.filters).toEqual([
      {
        logicalOperator: 'and',
        data: [{ field: 'brandId', comparisonOperator: '=', value: 4 }],
      },
    ]);
  });

  it('applies section gender on the public page and legacy product list', async () => {
    const pageQb = recordingQb();
    pageQb.qb.getOne = async () => ({ id: 1, sections: [{ items: [] }] });
    const pages = new PageService(
      { createQueryBuilder: () => pageQb.qb } as any,
      {} as any,
      {} as any,
      { unprocessableEntity: () => undefined } as any,
      { getTryToToman: async () => 1 } as any,
    );
    await pages.getById('1');
    const productJoin = pageQb.joins.find((args) => args[0] === 'items.product');
    expect(String(productJoin?.[2])).toContain('sections.productGender IS NULL');
    expect(String(productJoin?.[2])).toContain("sections.productGender = 'child'");

    const list = recordingQb();
    const productsApi = productServiceWith(list.qb);
    await productsApi.getAll(
      1,
      20,
      [
        {
          logicalOperator: 'and',
          data: [{ field: 'gender', comparisonOperator: '=', value: 'child' }],
        },
      ],
      null,
      null,
      {},
      null,
      [],
      null as any,
    );
    expect(list.wheres.some((w) => w.sql.includes('sectionGenders'))).toBe(false);

    const women = recordingQb();
    const womenApi = productServiceWith(women.qb);
    await womenApi.getAll(
      1,
      20,
      [
        {
          logicalOperator: 'and',
          data: [{ field: 'gender', comparisonOperator: '=', value: 'female' }],
        },
      ],
      null,
      null,
      {},
      null,
      [],
      null as any,
    );
    expect(
      women.wheres.find((w) => w.sql.includes('sectionGenders'))?.params
        ?.sectionGenders,
    ).toEqual(['female', 'unisex']);
    expect(
      women.wheres.some(
        (w) => w.sql.includes('gender') && w.sql.includes('= :gender'),
      ),
    ).toBe(false);
  });

  it('keeps direct product URLs and in-scope purchasing independent of gender', async () => {
    const pdp = recordingQb();
    const service = new CatalogService(
      {} as any,
      {} as any,
      { createQueryBuilder: () => pdp.qb } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(service.getStorefrontProductDetail(101)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const sql = pdp.wheres.map((w) => w.sql).join('\n');
    expect(sql).not.toContain('adultKidsExclusionIds');
    expect(sql).not.toContain('unresolvedReviewableCategoryIds');
    expect(sql).not.toContain('isCuratedExternalCatalog');
    expect(sql).not.toContain('product.gender');

    expect(evaluateAssortmentCommerceGate('IN_SCOPE').purchasable).toBe(true);
    expect(evaluateAssortmentCommerceGate('REVIEW_REQUIRED').purchasable).toBe(
      false,
    );
    expect(evaluateAssortmentCommerceGate('OUT_OF_SCOPE').purchasable).toBe(false);
  });
});
