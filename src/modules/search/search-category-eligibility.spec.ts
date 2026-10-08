import { CatalogService } from '../catalog/catalog.service';
import { CATALOG_MAPPING_V2_ENV } from '../catalog/canonical-product-eligibility';
import { CanonicalCategoryEntity } from '../catalog/entities/canonical-category.entity';
import { SourceCategoryMappingEntity } from '../catalog/entities/source-category-mapping.entity';
import { CategoryEntity } from '../category/entities/category.entity';
import { SearchService } from './search.service';
import { parseStorefrontSearchQuery } from './storefront-search.query';

/**
 * CAT-MAP-V2-B — category-scoped Search consumes the SAME eligibility as PLP.
 * Drives the real services with recording query builders (no DB).
 */

type Where = { sql: string; params?: Record<string, unknown> };

function recordingQb() {
  const wheres: Where[] = [];
  const qb: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return undefined;
        if (prop === 'andWhere' || prop === 'where') {
          return (sql: unknown, params?: Record<string, unknown>) => {
            wheres.push({ sql: String(sql), params });
            return qb;
          };
        }
        if (prop === 'getManyAndCount') return async () => [[], 0];
        if (prop === 'getRawMany' || prop === 'getMany') return async () => [];
        if (prop === 'getRawOne' || prop === 'getOne') return async () => null;
        return () => qb;
      },
    },
  );
  return { qb, wheres };
}

const canonicalRows = [
  {
    id: 1,
    parentId: null,
    status: 'active',
    displayOrder: 0,
    name: 'زنانه',
    audience: 'female',
  },
  {
    id: 20,
    parentId: 1,
    status: 'active',
    displayOrder: 0,
    name: 'تی‌شرت',
    audience: null,
  },
  {
    id: 6,
    parentId: null,
    status: 'active',
    displayOrder: 1,
    name: 'مردانه',
    audience: 'male',
  },
  {
    id: 40,
    parentId: 6,
    status: 'active',
    displayOrder: 0,
    name: 'تی‌شرت',
    audience: null,
  },
  {
    id: 14,
    parentId: null,
    status: 'active',
    displayOrder: 2,
    name: 'زیبایی',
    audience: null,
  },
  {
    id: 56,
    parentId: 14,
    status: 'active',
    displayOrder: 0,
    name: 'پوست',
    audience: null,
  },
];
const taxonomy = [
  {
    id: 100,
    parentId: null,
    source: 'trendyol',
    status: 'active',
    displayOrder: 0,
    name: 'T-Shirt',
  },
  {
    id: 101,
    parentId: 100,
    source: 'trendyol',
    status: 'active',
    displayOrder: 0,
    name: 'Oversize',
  },
  {
    id: 200,
    parentId: null,
    source: 'trendyol',
    status: 'active',
    displayOrder: 0,
    name: 'Kozmetik',
  },
];

let mappings: any[] = [];

const fakeManager = {
  find: async (entity: unknown) => {
    if (entity === CanonicalCategoryEntity) return canonicalRows;
    if (entity === SourceCategoryMappingEntity) return mappings;
    if (entity === CategoryEntity) return taxonomy;
    throw new Error('unexpected entity');
  },
};

function makeSearch() {
  const listing = recordingQb();
  const service = new SearchService(
    { createQueryBuilder: () => listing.qb } as any,
    { createQueryBuilder: () => recordingQb().qb } as any,
    { createQueryBuilder: () => recordingQb().qb } as any,
    { manager: fakeManager } as any,
    { getTryToToman: async () => 1 } as any,
  );
  return { service, listing };
}

function makeCatalog() {
  const listing = recordingQb();
  const service = new CatalogService(
    { manager: fakeManager } as any,
    {} as any,
    { createQueryBuilder: () => listing.qb } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, listing };
}

function query(categoryId?: number) {
  const parsed = parseStorefrontSearchQuery({ q: 'تیشرت', categoryId });
  if (parsed.ok === false) throw new Error(parsed.error.message);
  return parsed.value;
}

async function searchWheres(categoryId?: number): Promise<Where[]> {
  const { service, listing } = makeSearch();
  await service.searchCatalog(query(categoryId));
  return listing.wheres;
}

/** Eligibility predicates only, with the param prefix normalized. */
function eligibilityPredicates(wheres: Where[], prefix: string) {
  return wheres
    .filter(
      (w) =>
        w.params && Object.keys(w.params).some((k) => k.startsWith(prefix)),
    )
    .map((w) => ({
      sql: w.sql.split(prefix).join('P'),
      params: Object.fromEntries(
        Object.entries(w.params || {}).map(([k, v]) => [
          k.replace(prefix, 'P'),
          v,
        ]),
      ),
    }));
}

function setFlag(value: string | undefined) {
  if (value == null) delete process.env[CATALOG_MAPPING_V2_ENV];
  else process.env[CATALOG_MAPPING_V2_ENV] = value;
}

describe('CAT-MAP-V2-B Search parity with PLP eligibility', () => {
  const prevFlag = process.env[CATALOG_MAPPING_V2_ENV];
  afterEach(() => setFlag(prevFlag));

  beforeEach(() => {
    mappings = [
      {
        id: 1,
        sourceCategoryId: 100,
        canonicalCategoryId: 20,
        status: 'active',
        source: 'trendyol',
        genderSlice: 'any',
        reviewStatus: 'legacy_unreviewed',
      },
      {
        id: 2,
        sourceCategoryId: 100,
        canonicalCategoryId: 40,
        status: 'active',
        source: 'trendyol',
        genderSlice: 'any',
        reviewStatus: 'legacy_unreviewed',
      },
      {
        id: 3,
        sourceCategoryId: 200,
        canonicalCategoryId: 56,
        status: 'active',
        source: 'trendyol',
        genderSlice: 'any',
        reviewStatus: 'reviewed_ok',
      },
    ];
  });

  it('female category search: structural scope ∩ female+unisex (male/null excluded)', async () => {
    const preds = eligibilityPredicates(await searchWheres(1), 'searchElig');
    expect(preds).toEqual([
      {
        sql: 'product.categoryId IN (:...PCat0)',
        params: { PCat0: [100, 101] },
      },
      {
        sql: 'product.gender IN (:...PAudience)',
        params: { PAudience: ['female', 'unisex'] },
      },
    ]);
  });

  it('male category search: male+unisex (female/null excluded)', async () => {
    const preds = eligibilityPredicates(await searchWheres(40), 'searchElig');
    expect(preds[1]).toEqual({
      sql: 'product.gender IN (:...PAudience)',
      params: { PAudience: ['male', 'unisex'] },
    });
  });

  it('neutral category search: no adult gender restriction', async () => {
    const preds = eligibilityPredicates(await searchWheres(14), 'searchElig');
    expect(preds).toEqual([
      { sql: 'product.categoryId IN (:...PCat0)', params: { PCat0: [200] } },
    ]);
    const all = await searchWheres(14);
    expect(all.some((w) => w.sql.includes('product.gender'))).toBe(false);
  });

  it('global search is unscoped: no category or gender eligibility predicate', async () => {
    const all = await searchWheres(undefined);
    expect(eligibilityPredicates(all, 'searchElig')).toEqual([]);
    expect(all.some((w) => w.sql.includes('product.gender'))).toBe(false);
    expect(all.some((w) => w.sql.includes('searchScopeCategoryIds'))).toBe(
      false,
    );
  });

  it('unmapped category search returns empty without querying products', async () => {
    mappings = [];
    const { service, listing } = makeSearch();
    const res = await service.searchCatalog(query(1));
    expect(res.items).toEqual([]);
    expect(res.pagination.total).toBe(0);
    expect(listing.wheres).toEqual([]);
  });

  it.each([1, 20, 6, 40, 14, 56])(
    'category %i: Search and PLP apply identical eligibility predicates',
    async (categoryId) => {
      const search = eligibilityPredicates(
        await searchWheres(categoryId),
        'searchElig',
      );
      const { service, listing } = makeCatalog();
      const eligibility = await service.resolveCanonicalProductEligibility(
        categoryId,
      );
      (service as any)._buildEligibleProductBuilder(eligibility);
      const plp = eligibilityPredicates(listing.wheres, 'plpElig');
      expect(search).toEqual(plp);
      expect(search.length).toBeGreaterThan(0);
    },
  );

  it('reviewed slices with flag on: Search and PLP share slice predicates', async () => {
    setFlag('1');
    mappings = [
      {
        id: 10,
        sourceCategoryId: 100,
        canonicalCategoryId: 20,
        status: 'active',
        source: 'trendyol',
        genderSlice: 'female',
        reviewStatus: 'reviewed_ok',
      },
      {
        id: 11,
        sourceCategoryId: 100,
        canonicalCategoryId: 40,
        status: 'active',
        source: 'trendyol',
        genderSlice: 'male',
        reviewStatus: 'reviewed_ok',
      },
    ];
    const search = eligibilityPredicates(await searchWheres(1), 'searchElig');
    expect(search).toEqual([
      {
        sql: '(product.categoryId IN (:...PCat0) AND product.gender IN (:...PGender0))',
        params: { PCat0: [100, 101], PGender0: ['female', 'unisex'] },
      },
      {
        sql: 'product.gender IN (:...PAudience)',
        params: { PAudience: ['female', 'unisex'] },
      },
    ]);

    const { service, listing } = makeCatalog();
    const eligibility = await service.resolveCanonicalProductEligibility(1);
    (service as any)._buildEligibleProductIdBuilder(
      { getRepository: () => ({ createQueryBuilder: () => listing.qb }) },
      eligibility,
    );
    expect(eligibilityPredicates(listing.wheres, 'plpElig')).toEqual(search);
  });

  it('reviewed slices with flag off: slice rows contribute nothing (fail-closed)', async () => {
    setFlag(undefined);
    mappings = [
      {
        id: 10,
        sourceCategoryId: 100,
        canonicalCategoryId: 20,
        status: 'active',
        source: 'trendyol',
        genderSlice: 'female',
        reviewStatus: 'reviewed_ok',
      },
    ];
    const { service, listing } = makeSearch();
    const res = await service.searchCatalog(query(1));
    expect(res.pagination.total).toBe(0);
    expect(listing.wheres).toEqual([]);
  });
});
