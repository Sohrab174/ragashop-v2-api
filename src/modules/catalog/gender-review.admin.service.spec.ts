import { GenderReviewAdminService } from './gender-review.admin.service';
import { GenderReviewValidationError } from './gender-review.util';

function makeService(opts: {
  product: any;
  affected?: number;
  categories?: any[];
  domains?: Array<{ categoryId: number; businessDomain: string | null }>;
}) {
  const inserts: any[] = [];
  const updateSets: any[] = [];
  const em: any = {
    createQueryBuilder: () => {
      const qb: any = {
        update: () => qb,
        set: (v: any) => {
          updateSets.push(v);
          return qb;
        },
        where: () => qb,
        andWhere: () => qb,
        execute: async () => ({ affected: opts.affected ?? 1 }),
      };
      return qb;
    },
    findOne: async () => ({ id: 1, policyVersion: 7 }),
    query: async () => opts.domains ?? [],
    insert: async (_entity: any, row: any) => {
      inserts.push(row);
    },
  };
  const productRepository: any = {
    findOne: async () => opts.product,
    manager: {
      transaction: async (fn: any) => fn(em),
      find: async () => [],
      query: async () => opts.domains ?? [],
    },
  };
  const mappingRepository: any = { find: async () => [] };
  const service = new GenderReviewAdminService(
    productRepository,
    { find: async () => opts.categories ?? [] } as any,
    mappingRepository,
  );
  return { service, inserts, updateSets };
}

describe('GenderReviewAdminService.resolveProductGenderAdmin', () => {
  it('writes gender + append-only audit for an unresolved product', async () => {
    const { service, inserts, updateSets } = makeService({
      product: { id: 5, gender: null, categoryId: 40, name: 'x', status: 'active' },
    });
    const res = await service.resolveProductGenderAdmin({
      productId: 5,
      gender: 'female',
      actor: 'user:admin',
    });
    expect(updateSets).toEqual([{ gender: 'female' }]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      operation: 'product_gender_resolve',
      ruleId: null,
      actor: 'user:admin',
      beforeJson: { productId: 5, gender: null, categoryId: 40 },
      afterJson: { productId: 5, gender: 'female', categoryId: 40 },
    });
    expect(res).toMatchObject({ productId: 5, previousGender: null, gender: 'female' });
  });

  it('refuses to overwrite an already classified product', async () => {
    const { service, inserts } = makeService({
      product: { id: 5, gender: 'male', categoryId: 40 },
    });
    await expect(
      service.resolveProductGenderAdmin({ productId: 5, gender: 'female' }),
    ).rejects.toMatchObject({ code: 'already_resolved' });
    expect(inserts).toHaveLength(0);
  });

  it('concurrent resolution (0 rows updated) aborts without audit', async () => {
    const { service, inserts } = makeService({
      product: { id: 5, gender: null, categoryId: 40 },
      affected: 0,
    });
    await expect(
      service.resolveProductGenderAdmin({ productId: 5, gender: 'male' }),
    ).rejects.toBeInstanceOf(GenderReviewValidationError);
    expect(inserts).toHaveLength(0);
  });

  it('does not assign an adult gender to a household category', async () => {
    const { service, inserts } = makeService({
      product: { id: 8, gender: null, categoryId: 352, name: 'rug', status: 'active' },
      categories: [
        {
          id: 352,
          hierarchy: 'Ev & Mobilya/Mobilya/Halı / Kilim/Halı',
          gender: null,
          bankTypeName: null,
        },
      ],
      domains: [{ categoryId: 352, businessDomain: 'home_rugs' }],
    });
    await expect(
      service.resolveProductGenderAdmin({ productId: 8, gender: 'unisex' }),
    ).rejects.toMatchObject({ code: 'not_applicable' });
    expect(inserts).toHaveLength(0);
  });

  it('rejects invalid gender and missing product', async () => {
    const { service } = makeService({ product: null });
    await expect(
      service.resolveProductGenderAdmin({ productId: 5, gender: 'kids' }),
    ).rejects.toMatchObject({ code: 'invalid_gender' });
    await expect(
      service.resolveProductGenderAdmin({ productId: 5, gender: 'unisex' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('does not assign an adult gender to confident children apparel', async () => {
    const { service, inserts, updateSets } = makeService({
      product: {
        id: 11,
        gender: null,
        categoryId: 40,
        name: 'تیشرت کودک',
        sourceName: 'Erkek Çocuk Penye Polo Yaka T-shirt',
        ageGroup: null,
        status: 'active',
      },
      categories: [
        {
          id: 40,
          hierarchy: 'Giyim/Üst Giyim/T-Shirt',
          gender: null,
          bankTypeName: null,
        },
      ],
      domains: [{ categoryId: 40, businessDomain: 'fashion_apparel' }],
    });
    await expect(
      service.resolveProductGenderAdmin({ productId: 11, gender: 'female' }),
    ).rejects.toMatchObject({ code: 'not_applicable' });
    expect(updateSets).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('does not overwrite an existing gender on children apparel', async () => {
    const { service, inserts, updateSets } = makeService({
      product: {
        id: 12,
        gender: 'female',
        categoryId: 40,
        name: 'Çocuk Tişört',
        sourceName: 'Çocuk Tişört',
        status: 'active',
      },
      categories: [
        {
          id: 40,
          hierarchy: 'Giyim/Üst Giyim/T-Shirt',
          gender: null,
          bankTypeName: null,
        },
      ],
      domains: [{ categoryId: 40, businessDomain: 'fashion_apparel' }],
    });
    await expect(
      service.resolveProductGenderAdmin({ productId: 12, gender: 'male' }),
    ).rejects.toMatchObject({ code: 'not_applicable' });
    expect(updateSets).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('does not assign an adult gender to a children EU shoe size run', async () => {
    const { service, inserts, updateSets } = makeService({
      product: {
        id: 91766,
        gender: null,
        categoryId: 70,
        name: 'کفش ران فالکون 5 کودکان',
        sourceName: '5 El C Lacivert Unisex Koşu Ve Antreman Ayakkabısı Runfalcon',
        ageGroup: 'child',
        status: 'active',
      },
      categories: [
        {
          id: 70,
          hierarchy: 'Ayakkabı/Spor Ayakkabı/Koşu & Antrenman Ayakkabısı',
          gender: null,
          bankTypeName: null,
        },
      ],
      domains: [{ categoryId: 70, businessDomain: 'fashion_shoes' }],
    });
    const originalQuery = service['productRepository'].manager.query;
    service['productRepository'].manager.query = async (sql: string) => {
      if (String(sql).includes('product_attribute_value')) {
        return ['27,5', '30', '34', '35'].map((value) => ({
          productId: 91766,
          name: 'سایز',
          sourceName: 'Beden',
          kind: 'other',
          value,
          valueSource: value,
        }));
      }
      return originalQuery(sql);
    };
    await expect(
      service.resolveProductGenderAdmin({ productId: 91766, gender: 'unisex' }),
    ).rejects.toMatchObject({ code: 'not_applicable' });
    expect(updateSets).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('does not overwrite an existing gender on a children EU shoe size run', async () => {
    const { service, inserts, updateSets } = makeService({
      product: {
        id: 91767,
        gender: 'male',
        categoryId: 70,
        name: 'Runfalcon',
        sourceName: '5 El C Lacivert Unisex Koşu Ve Antreman Ayakkabısı Runfalcon',
        status: 'active',
      },
      categories: [
        {
          id: 70,
          hierarchy: 'Ayakkabı/Spor Ayakkabı/Koşu & Antrenman Ayakkabısı',
          gender: null,
          bankTypeName: null,
        },
      ],
      domains: [{ categoryId: 70, businessDomain: 'fashion_shoes' }],
    });
    const originalQuery = service['productRepository'].manager.query;
    service['productRepository'].manager.query = async (sql: string) => {
      if (String(sql).includes('product_attribute_value')) {
        return ['28', '34'].map((value) => ({
          productId: 91767,
          name: 'سایز',
          sourceName: 'Beden',
          kind: 'other',
          value,
          valueSource: value,
        }));
      }
      return originalQuery(sql);
    };
    await expect(
      service.resolveProductGenderAdmin({ productId: 91767, gender: 'female' }),
    ).rejects.toMatchObject({ code: 'not_applicable' });
    expect(updateSets).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('does not assign an adult gender to confident children footwear', async () => {
    const { service, inserts } = makeService({
      product: {
        id: 9,
        gender: null,
        categoryId: 70,
        name: 'Cırtlı Çocuk Ayakkabı Sneaker',
        sourceName: 'Cırtlı Çocuk Ayakkabı Sneaker',
        status: 'active',
      },
      categories: [
        {
          id: 70,
          hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
          gender: null,
          bankTypeName: null,
        },
      ],
      domains: [{ categoryId: 70, businessDomain: 'fashion_shoes' }],
    });
    await expect(
      service.resolveProductGenderAdmin({ productId: 9, gender: 'unisex' }),
    ).rejects.toMatchObject({ code: 'not_applicable' });
    expect(inserts).toHaveLength(0);
  });
});

describe('GenderReviewAdminService queue summary and pagination', () => {
  function queueService() {
    const wheres: Array<{ sql: string; params?: Record<string, unknown> }> = [];
    const qb: any = {
      where: () => qb,
      andWhere: (sql: string, params?: Record<string, unknown>) => {
        wheres.push({ sql, params });
        return qb;
      },
      leftJoinAndSelect: () => qb,
      orderBy: () => qb,
      select: () => qb,
      addSelect: () => qb,
      groupBy: () => qb,
      take: () => qb,
      skip: () => qb,
      getRawMany: async () => [{ categoryId: 70, n: 3 }],
      getCount: async () => 49,
      getMany: async () => [
        {
          id: 1,
          categoryId: 70,
          name: 'Cırtlı Çocuk Ayakkabı Sneaker',
          sourceName: 'Cırtlı Çocuk Ayakkabı Sneaker',
          ageGroup: 'child',
        },
        {
          id: 2,
          categoryId: 70,
          name: 'Court Vision Sneaker',
          sourceName: 'Court Vision Sneaker',
          ageGroup: 'child',
        },
        {
          id: 3,
          categoryId: 70,
          name: 'Kadın Çocuk Sneaker',
          sourceName: 'Kadın Çocuk Sneaker',
          ageGroup: null,
        },
      ],
      getManyAndCount: async () => [
        [
          {
            id: 2,
            categoryId: 70,
            name: 'Court Vision Sneaker',
            sourceName: 'Court Vision Sneaker',
            gender: null,
            status: 'active',
            price: 10,
            source: 'trendyol',
            sourceUrl: null,
            number: null,
            createdAt: null,
            category: { name: 'Sneaker', sourceName: 'Sneaker', source: 'trendyol' },
            cover: { pathFile: 'adult.jpg' },
          },
          {
            id: 3,
            categoryId: 70,
            name: 'Kadın Çocuk Sneaker',
            sourceName: 'Kadın Çocuk Sneaker',
            gender: null,
            status: 'active',
            price: 10,
            source: 'trendyol',
            sourceUrl: null,
            number: null,
            createdAt: new Date('2026-01-02T00:00:00Z'),
            category: { name: 'Sneaker', sourceName: 'Sneaker', source: 'trendyol' },
            cover: null,
          },
        ],
        2,
      ],
    };
    const productRepository: any = {
      createQueryBuilder: () => qb,
      manager: {
        query: async (sql: string) =>
          String(sql).includes('businessDomain')
            ? [{ categoryId: 70, businessDomain: 'fashion_shoes' }]
            : [],
      },
    };
    const categoryRepository: any = {
      find: async () => [
        {
          id: 70,
          parentId: null,
          hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
          gender: null,
          bankTypeName: null,
          source: 'trendyol',
          sourceName: 'Sneaker',
          name: 'Sneaker',
          status: 'active',
        },
      ],
    };
    const service = new GenderReviewAdminService(
      productRepository,
      categoryRepository,
      { find: async () => [] } as any,
    );
    return { service, wheres };
  }

  it('moves confident children footwear out of the review count', async () => {
    const { service } = queueService();
    const summary = await service.getSummaryAdmin({ scope: 'discoverable' });
    expect(summary.reviewRequiredCount).toBe(2);
    expect(summary.notApplicableCount).toBe(1);
    expect(summary.resolvedCount).toBe(49);
    expect(summary.excludedByReason).toEqual([
      expect.objectContaining({ reason: 'kids_footwear', count: 1 }),
    ]);
    expect(summary.reviewByReason).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'footwear', count: 1 }),
        expect.objectContaining({ reason: 'conflicting_signals', count: 1 }),
      ]),
    );
  });

  it('paginates after hiding children footwear and keeps short reason labels', async () => {
    const { service, wheres } = queueService();
    const page = await service.listQueueAdmin({
      page: 1,
      limit: 30,
      scope: 'discoverable',
    });
    expect(page.pagination).toMatchObject({ totalItems: 2, currentPage: 1, totalPages: 1 });
    expect(page.items.map((item) => item.id)).toEqual([2, 3]);
    expect(page.items.map((item) => item.id)).not.toContain(1);
    expect(
      wheres.some(
        (entry) =>
          entry.sql.includes('NOT IN') &&
          Array.isArray(entry.params?.hiddenChildFootwearIds) &&
          (entry.params?.hiddenChildFootwearIds as number[]).includes(1),
      ),
    ).toBe(true);
    expect(page.items[0]).toMatchObject({
      relevanceReason: 'footwear',
      relevanceReasonBadge: 'کفش نیازمند بررسی',
      coverPath: 'adult.jpg',
    });
    expect(page.items[1]).toMatchObject({
      relevanceReason: 'conflicting_signals',
      relevanceReasonBadge: 'اطلاعات متناقض',
    });
    expect(page.items[1].relevanceReasonLabel).toContain('کودک');
  });

  it('paginates after hiding a children Beden size run', async () => {
    const wheres: Array<{ sql: string; params?: Record<string, unknown> }> = [];
    const qb: any = {
      where: () => qb,
      andWhere: (sql: string, params?: Record<string, unknown>) => {
        wheres.push({ sql, params });
        return qb;
      },
      leftJoinAndSelect: () => qb,
      orderBy: () => qb,
      select: () => qb,
      addSelect: () => qb,
      groupBy: () => qb,
      take: () => qb,
      skip: () => qb,
      getRawMany: async () => [{ categoryId: 70, n: 2 }],
      getCount: async () => 0,
      getMany: async () => [
        {
          id: 91766,
          categoryId: 70,
          name: 'کفش ران فالکون 5 کودکان',
          sourceName: '5 El C Lacivert Unisex Koşu Ve Antreman Ayakkabısı Runfalcon',
          ageGroup: 'child',
        },
        {
          id: 27124,
          categoryId: 70,
          name: 'Hoops',
          sourceName: 'Hoops 3.0 Bold W Yüksek Taban Sneaker',
          ageGroup: 'child',
        },
      ],
      getManyAndCount: async () => [
        [
          {
            id: 27124,
            categoryId: 70,
            name: 'Hoops',
            sourceName: 'Hoops 3.0 Bold W Yüksek Taban Sneaker',
            gender: null,
            status: 'active',
            price: 10,
            source: 'trendyol',
            sourceUrl: null,
            number: null,
            createdAt: null,
            category: { name: 'Sneaker', sourceName: 'Sneaker', source: 'trendyol' },
            cover: null,
          },
        ],
        1,
      ],
    };
    const service = new GenderReviewAdminService(
      {
        createQueryBuilder: () => qb,
        manager: {
          query: async (sql: string) => {
            if (String(sql).includes('businessDomain')) {
              return [{ categoryId: 70, businessDomain: 'fashion_shoes' }];
            }
            if (String(sql).includes('product_attribute_value')) {
              return [
                ...['27,5', '34', '35'].map((value) => ({
                  productId: 91766,
                  name: 'سایز',
                  sourceName: 'Beden',
                  kind: 'other',
                  value,
                  valueSource: value,
                })),
                ...['36', '40', '44'].map((value) => ({
                  productId: 27124,
                  name: 'سایز',
                  sourceName: 'Beden',
                  kind: 'other',
                  value,
                  valueSource: value,
                })),
              ];
            }
            return [];
          },
        },
      } as any,
      {
        find: async () => [
          {
            id: 70,
            parentId: null,
            hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
            gender: null,
            bankTypeName: null,
            source: 'trendyol',
            sourceName: 'Sneaker',
            name: 'Sneaker',
            status: 'active',
          },
        ],
      } as any,
      { find: async () => [] } as any,
    );
    const page = await service.listQueueAdmin({
      page: 1,
      limit: 30,
      scope: 'discoverable',
    });
    expect(page.items.map((item) => item.id)).toEqual([27124]);
    expect(
      wheres.some(
        (entry) =>
          entry.sql.includes('NOT IN') &&
          Array.isArray(entry.params?.hiddenChildFootwearIds) &&
          (entry.params?.hiddenChildFootwearIds as number[]).includes(91766) &&
          !(entry.params?.hiddenChildFootwearIds as number[]).includes(27124),
      ),
    ).toBe(true);
  });

  function apparelQueueService() {
    const wheres: Array<{ sql: string; params?: Record<string, unknown> }> = [];
    const qb: any = {
      where: () => qb,
      andWhere: (sql: string, params?: Record<string, unknown>) => {
        wheres.push({ sql, params });
        return qb;
      },
      leftJoinAndSelect: () => qb,
      orderBy: () => qb,
      select: () => qb,
      addSelect: () => qb,
      groupBy: () => qb,
      take: () => qb,
      skip: () => qb,
      getRawMany: async () => [{ categoryId: 40, n: 4 }],
      getCount: async () => 12,
      getMany: async () => [
        {
          id: 21,
          categoryId: 40,
          name: 'ست پیژامه نوزاد',
          sourceName: 'Düğmeli Bebek Pijama Takımı',
          ageGroup: null,
        },
        {
          id: 22,
          categoryId: 40,
          name: 'هودی',
          sourceName: 'Radiohead Kapşonlu',
          ageGroup: 'child',
        },
        {
          id: 23,
          categoryId: 40,
          name: 'تیشرت مادر و دختر',
          sourceName: 'Anne Kız Tişört',
          ageGroup: 'child',
        },
        {
          id: 24,
          categoryId: 40,
          name: 'سویشرت',
          sourceName: 'Unisex Sweatshirt',
          ageGroup: null,
        },
      ],
      getManyAndCount: async () => [
        [
          {
            id: 22,
            categoryId: 40,
            name: 'هودی',
            sourceName: 'Radiohead Kapşonlu',
            gender: null,
            status: 'active',
            price: 10,
            source: 'trendyol',
            sourceUrl: null,
            number: null,
            createdAt: null,
            category: { name: 'T-Shirt', sourceName: 'T-Shirt', source: 'trendyol' },
            cover: { pathFile: 'adult.jpg' },
          },
          {
            id: 23,
            categoryId: 40,
            name: 'تیشرت مادر و دختر',
            sourceName: 'Anne Kız Tişört',
            gender: null,
            status: 'active',
            price: 10,
            source: 'trendyol',
            sourceUrl: null,
            number: null,
            createdAt: null,
            category: { name: 'T-Shirt', sourceName: 'T-Shirt', source: 'trendyol' },
            cover: null,
          },
          {
            id: 24,
            categoryId: 40,
            name: 'سویشرت',
            sourceName: 'Unisex Sweatshirt',
            gender: null,
            status: 'active',
            price: 10,
            source: 'trendyol',
            sourceUrl: null,
            number: null,
            createdAt: null,
            category: { name: 'T-Shirt', sourceName: 'T-Shirt', source: 'trendyol' },
            cover: null,
          },
        ],
        3,
      ],
    };
    const productRepository: any = {
      createQueryBuilder: () => qb,
      findOne: async () => ({
        id: 21,
        gender: null,
        categoryId: 40,
        name: 'ست پیژامه نوزاد',
        sourceName: 'Düğmeli Bebek Pijama Takımı',
        status: 'active',
        category: { name: 'T-Shirt', sourceName: 'T-Shirt', source: 'trendyol' },
        cover: null,
      }),
      manager: {
        query: async (sql: string) => {
          if (String(sql).includes('businessDomain')) {
            return [{ categoryId: 40, businessDomain: 'fashion_apparel' }];
          }
          if (String(sql).includes('product_attribute_value')) {
            return [
              {
                productId: 21,
                name: 'Beden',
                sourceName: 'Beden',
                kind: 'other',
                value: 'Yeni Doğan',
                valueSource: 'Yeni Doğan',
              },
              {
                productId: 22,
                name: 'Beden',
                sourceName: 'Beden',
                kind: 'other',
                value: 'M',
                valueSource: 'M',
              },
              {
                productId: 24,
                name: 'Beden',
                sourceName: 'Beden',
                kind: 'other',
                value: 'S',
                valueSource: 'S',
              },
              {
                productId: 24,
                name: 'Beden',
                sourceName: 'Beden',
                kind: 'other',
                value: '4-6 Yaş',
                valueSource: '4-6 Yaş',
              },
            ];
          }
          return [];
        },
      },
    };
    const categoryRepository: any = {
      find: async () => [
        {
          id: 40,
          parentId: null,
          hierarchy: 'Giyim/Üst Giyim/T-Shirt',
          gender: null,
          bankTypeName: null,
          source: 'trendyol',
          sourceName: 'T-Shirt',
          name: 'T-Shirt',
          status: 'active',
        },
      ],
    };
    const service = new GenderReviewAdminService(
      productRepository,
      categoryRepository,
      { find: async () => [] } as any,
    );
    return { service, wheres };
  }

  it('moves confident children apparel out of the review count', async () => {
    const { service } = apparelQueueService();
    const summary = await service.getSummaryAdmin({ scope: 'discoverable' });
    expect(summary.reviewRequiredCount).toBe(3);
    expect(summary.notApplicableCount).toBe(1);
    expect(summary.resolvedCount).toBe(12);
    expect(summary.excludedByReason).toEqual([
      expect.objectContaining({ reason: 'kids_apparel', count: 1 }),
    ]);
    expect(summary.reviewByReason).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'adult_apparel', count: 1 }),
        expect.objectContaining({ reason: 'conflicting_signals', count: 2 }),
      ]),
    );
  });

  it('paginates after hiding children apparel and previews the excluded product', async () => {
    const { service, wheres } = apparelQueueService();
    const page = await service.listQueueAdmin({
      page: 1,
      limit: 30,
      scope: 'discoverable',
    });
    expect(page.pagination).toMatchObject({ totalItems: 3, currentPage: 1, totalPages: 1 });
    expect(page.items.map((item) => item.id)).toEqual([22, 23, 24]);
    expect(
      wheres.some(
        (entry) =>
          entry.sql.includes('NOT IN') &&
          Array.isArray(entry.params?.hiddenChildApparelIds) &&
          (entry.params?.hiddenChildApparelIds as number[]).includes(21),
      ),
    ).toBe(true);
    expect(page.items[0]).toMatchObject({
      relevanceReason: 'adult_apparel',
      relevanceReasonBadge: 'لباس بدون جنسیت',
    });
    expect(page.items[1]).toMatchObject({
      relevanceReason: 'conflicting_signals',
      relevanceReasonBadge: 'اطلاعات متناقض',
    });
    expect(page.items[2]).toMatchObject({
      relevanceReason: 'conflicting_signals',
    });

    const preview = await service.getProductPreviewAdmin(21);
    expect(preview.product).toMatchObject({
      id: 21,
      gender: null,
      relevance: 'gender_not_applicable',
      relevanceReason: 'kids_apparel',
      relevanceReasonBadge: 'لباس کودک',
      variantSizes: ['Yeni Doğan'],
      sourceAttributes: [],
    });
  });

  it('preview returns deduplicated sizes and curated source attributes without writing gender', async () => {
    const updateSets: any[] = [];
    const inserts: any[] = [];
    const productRepository: any = {
      createQueryBuilder: () => ({
        where: () => productRepository.createQueryBuilder(),
        andWhere: () => productRepository.createQueryBuilder(),
        leftJoinAndSelect: () => productRepository.createQueryBuilder(),
        orderBy: () => productRepository.createQueryBuilder(),
        select: () => productRepository.createQueryBuilder(),
        addSelect: () => productRepository.createQueryBuilder(),
        groupBy: () => productRepository.createQueryBuilder(),
        take: () => productRepository.createQueryBuilder(),
        skip: () => productRepository.createQueryBuilder(),
        getRawMany: async () => [],
        getCount: async () => 0,
        getMany: async () => [],
        getManyAndCount: async () => [[], 0],
      }),
      findOne: async () => ({
        id: 91766,
        gender: null,
        categoryId: 70,
        name: 'کفش ران فالکون 5 کودکان',
        sourceName: '5 El C Lacivert Unisex Koşu Ve Antreman Ayakkabısı Runfalcon',
        ageGroup: 'child',
        status: 'active',
        category: { name: 'Sneaker', sourceName: 'Sneaker', source: 'trendyol' },
        cover: { pathFile: 'runfalcon.jpg' },
      }),
      manager: {
        query: async (sql: string) => {
          if (String(sql).includes('businessDomain')) {
            return [{ categoryId: 70, businessDomain: 'fashion_shoes' }];
          }
          if (String(sql).includes('product_attribute_value')) {
            return [
              {
                productId: 91766,
                name: 'سایز',
                sourceName: 'Beden',
                kind: 'other',
                value: '۳۶',
                valueSource: '36',
              },
              {
                productId: 91766,
                name: 'سایز',
                sourceName: 'Beden',
                kind: 'other',
                value: '۳۶',
                valueSource: '36',
              },
              {
                productId: 91766,
                name: 'سایز',
                sourceName: 'Beden',
                kind: 'other',
                value: '۳۸',
                valueSource: '38',
              },
              {
                productId: 91766,
                name: 'رنگ',
                sourceName: 'Renk',
                kind: 'color',
                value: 'آبی',
                valueSource: 'Lacivert',
              },
              {
                productId: 91766,
                name: 'خالی',
                sourceName: 'Empty',
                kind: 'other',
                value: '',
                valueSource: null,
              },
            ];
          }
          return [];
        },
        transaction: async (fn: any) =>
          fn({
            createQueryBuilder: () => {
              const qb: any = {
                update: () => qb,
                set: (v: any) => {
                  updateSets.push(v);
                  return qb;
                },
                where: () => qb,
                andWhere: () => qb,
                execute: async () => ({ affected: 1 }),
              };
              return qb;
            },
            findOne: async () => ({ id: 1 }),
            insert: async (_e: any, row: any) => inserts.push(row),
          }),
      },
    };
    const service = new GenderReviewAdminService(
      productRepository,
      {
        find: async () => [
          {
            id: 70,
            parentId: null,
            hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
            gender: null,
            bankTypeName: null,
            source: 'trendyol',
            sourceName: 'Sneaker',
            name: 'Sneaker',
            status: 'active',
          },
        ],
      } as any,
      { find: async () => [] } as any,
    );

    const preview = await service.getProductPreviewAdmin(91766);
    expect(preview.product).toMatchObject({
      id: 91766,
      name: 'کفش ران فالکون 5 کودکان',
      sourceName: '5 El C Lacivert Unisex Koşu Ve Antreman Ayakkabısı Runfalcon',
      gender: null,
      coverPath: 'runfalcon.jpg',
      variantSizes: ['36', '38'],
      sourceAttributes: [{ name: 'رنگ', sourceName: 'Renk', values: ['Lacivert'] }],
    });
    expect(preview.product.sourceAttributes.every((row) => row.sourceName !== 'Beden')).toBe(
      true,
    );
    expect(updateSets).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });
});
