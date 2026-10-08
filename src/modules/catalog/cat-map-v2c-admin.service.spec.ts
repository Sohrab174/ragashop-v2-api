import { CatMapV2cAdminService } from './cat-map-v2c-admin.service';
import { SourceCategoryMappingV2ValidationError } from './cat-map-v2c-write.validation';

describe('CAT-MAP-V2-C AdminService save transition', () => {
  function makeService(opts?: {
    existing?: any[];
    saveImpl?: (row: any) => Promise<any>;
  }) {
    const existing = opts?.existing ?? [
      {
        id: 1,
        sourceCategoryId: 120,
        canonicalCategoryId: 40,
        genderSlice: 'any',
        status: 'active',
        reviewStatus: 'legacy_unreviewed',
        source: 'trendyol',
        note: null,
      },
    ];

    const savedRows: any[] = [];
    const repo = {
      findOne: jest.fn(async ({ where }: any) => {
        if (where.id != null) {
          return existing.find((e) => e.id === where.id);
        }
        return (
          existing.find(
            (e) =>
              e.sourceCategoryId === where.sourceCategoryId &&
              e.genderSlice === where.genderSlice,
          ) ||
          savedRows.find(
            (e) =>
              e.sourceCategoryId === where.sourceCategoryId &&
              e.genderSlice === where.genderSlice,
          ) ||
          undefined
        );
      }),
      find: jest.fn(async ({ where }: any) => {
        const all = [...existing, ...savedRows];
        if (where?.sourceCategoryId != null) {
          return all.filter(
            (e) => e.sourceCategoryId === where.sourceCategoryId,
          );
        }
        return all;
      }),
      create: jest.fn((row: any) => ({ ...row, id: undefined })),
      save: jest.fn(async (row: any) => {
        if (opts?.saveImpl) return opts.saveImpl(row);
        const next = {
          ...row,
          id: row.id ?? savedRows.length + 100,
        };
        const idx = savedRows.findIndex(
          (r) =>
            r.sourceCategoryId === next.sourceCategoryId &&
            r.genderSlice === next.genderSlice,
        );
        if (idx >= 0) savedRows[idx] = next;
        else savedRows.push(next);
        // mirror into existing for subsequent finds in same tx
        const eidx = existing.findIndex(
          (r) =>
            r.sourceCategoryId === next.sourceCategoryId &&
            r.genderSlice === next.genderSlice,
        );
        if (eidx >= 0) existing[eidx] = next;
        else if (next.genderSlice !== 'any') {
          /* keep legacy row until deactivated */
        }
        return next;
      }),
    };

    const manager = {
      getRepository: () => repo,
      transaction: async (fn: any) => fn(manager),
    };

    const mappingRepository = {
      find: jest.fn(async () => [...existing]),
      findOne: repo.findOne,
      manager,
      create: repo.create,
      save: repo.save,
    };

    const categoryRepository = {
      findOne: jest.fn(async () => ({
        id: 120,
        source: 'trendyol',
        status: 'active',
        name: 'تیشرت',
        sourceName: 'T-Shirt',
        sourceId: '1001',
        parentId: 110,
      })),
      find: jest.fn(async () => [
        {
          id: 120,
          parentId: null,
          source: 'trendyol',
          status: 'active',
          name: 'T',
          sourceName: 'T-Shirt',
          displayOrder: 0,
        },
      ]),
    };

    const canonicalRepository = {
      find: jest.fn(async () => [
        {
          id: 1,
          parentId: null,
          name: 'زنانه',
          audience: 'female',
          status: 'active',
        },
        {
          id: 20,
          parentId: 1,
          name: 'تیشرت',
          audience: null,
          status: 'active',
        },
        {
          id: 6,
          parentId: null,
          name: 'مردانه',
          audience: 'male',
          status: 'active',
        },
        {
          id: 40,
          parentId: 6,
          name: 'تیشرت',
          audience: null,
          status: 'active',
        },
      ]),
    };

    const productQb: any = {
      select: () => productQb,
      addSelect: () => productQb,
      where: () => productQb,
      andWhere: () => productQb,
      groupBy: () => productQb,
      getRawMany: async () => [
        { gender: 'female', count: '10' },
        { gender: 'male', count: '8' },
      ],
      getCount: async () => 18,
    };

    const productRepository = {
      createQueryBuilder: () => productQb,
    };

    const assortmentResolutionRepository = {
      find: async () => [],
    };

    const service = new CatMapV2cAdminService(
      canonicalRepository as any,
      mappingRepository as any,
      categoryRepository as any,
      productRepository as any,
      assortmentResolutionRepository as any,
    );

    return { service, repo, existing, savedRows, mappingRepository };
  }

  it('legacy any → female+male: migrates reviewStatus and deactivates any', async () => {
    const { service, existing } = makeService();
    const result = await service.saveSourceMappingV2Admin(120, {
      rules: [
        { genderSlice: 'female', canonicalCategoryId: 20 },
        { genderSlice: 'male', canonicalCategoryId: 40 },
      ],
      confirmImpact: true,
    });

    expect(result.reviewStatus).toBe('migrated');
    expect(result.rules.map((r) => r.genderSlice).sort()).toEqual([
      'female',
      'male',
    ]);
    const legacy = existing.find((e) => e.genderSlice === 'any');
    expect(legacy.status).toBe('inactive');
    expect(legacy.reviewStatus).toBe('migrated');
  });

  it('fresh source (no legacy) → reviewed_ok', async () => {
    const { service } = makeService({ existing: [] });
    const result = await service.saveSourceMappingV2Admin(120, {
      rules: [{ genderSlice: 'female', canonicalCategoryId: 20 }],
      confirmImpact: true,
    });
    expect(result.reviewStatus).toBe('reviewed_ok');
  });

  it('rejects invalid source before any write', async () => {
    const { service, repo } = makeService();
    (service as any).categoryRepository.findOne = jest.fn(
      async () => undefined,
    );
    await expect(
      service.saveSourceMappingV2Admin(999, {
        rules: [{ genderSlice: 'female', canonicalCategoryId: 20 }],
        confirmImpact: true,
      }),
    ).rejects.toBeInstanceOf(SourceCategoryMappingV2ValidationError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('does not open transaction when second rule fails audience validation', async () => {
    const { service, mappingRepository } = makeService();
    const tx = jest.spyOn(mappingRepository.manager, 'transaction');
    await expect(
      service.saveSourceMappingV2Admin(120, {
        rules: [
          { genderSlice: 'female', canonicalCategoryId: 20 },
          { genderSlice: 'male', canonicalCategoryId: 20 },
        ],
        confirmImpact: true,
      }),
    ).rejects.toBeInstanceOf(SourceCategoryMappingV2ValidationError);
    expect(tx).not.toHaveBeenCalled();
  });

  it('propagates mid-transaction failure (no silent partial success)', async () => {
    let saves = 0;
    const { service } = makeService({
      existing: [],
      saveImpl: async (row) => {
        saves += 1;
        if (saves === 2) throw new Error('unique constraint');
        return { ...row, id: saves + 10 };
      },
    });
    await expect(
      service.saveSourceMappingV2Admin(120, {
        rules: [
          { genderSlice: 'female', canonicalCategoryId: 20 },
          { genderSlice: 'male', canonicalCategoryId: 40 },
        ],
        confirmImpact: true,
      }),
    ).rejects.toThrow(/unique constraint/);
  });
});
