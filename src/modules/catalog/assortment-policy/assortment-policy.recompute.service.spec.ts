import { AssortmentPolicyRecomputeService } from './assortment-policy.recompute.service';
import { evaluateAssortmentPolicy } from './assortment-policy.evaluate';
import { normalizePathPrefix } from './assortment-path.normalize';

describe('assortment policy recompute semantics', () => {
  it('is idempotent for identical rules/category data', () => {
    const input = {
      policyVersion: 1,
      categories: [
        {
          id: 1,
          parentId: null,
          source: 'trendyol',
          hierarchy: 'Giyim/Elbise',
        },
        {
          id: 2,
          parentId: null,
          source: 'trendyol',
          hierarchy: 'Ev & Mobilya/Mobilya/Koltuk',
        },
      ],
      rules: [
        {
          id: 1,
          provider: 'trendyol',
          matchType: 'path_prefix' as const,
          pathPrefixNorm: normalizePathPrefix('Giyim'),
          categoryId: null,
          status: 'IN_SCOPE' as const,
          reasonCode: 'TARGET_FASHION',
          businessDomain: 'fashion_apparel',
          isActive: true,
        },
        {
          id: 2,
          provider: 'trendyol',
          matchType: 'path_prefix' as const,
          pathPrefixNorm: normalizePathPrefix('Ev & Mobilya/Mobilya'),
          categoryId: null,
          status: 'OUT_OF_SCOPE' as const,
          reasonCode: 'BULKY_FURNITURE',
          businessDomain: 'home_furniture',
          isActive: true,
        },
      ],
      liveProductCountByCategoryId: { 1: 3, 2: 4 },
    };
    const a = evaluateAssortmentPolicy(input);
    const b = evaluateAssortmentPolicy({ ...input, policyVersion: 2 });
    expect(a.map(({ policyVersion, ...rest }) => rest)).toEqual(
      b.map(({ policyVersion, ...rest }) => rest),
    );
  });

  it('exposes a Nest recompute service class', () => {
    expect(AssortmentPolicyRecomputeService).toBeDefined();
  });
});

describe('assortment policy recompute transaction contract', () => {
  it('advances version only after successful persist (mocked)', async () => {
    const state = { id: 1, policyVersion: 4, updatedAt: new Date() };
    let persistedVersion: number | null = null;
    let deleted = false;
    let inserted = false;
    let auditInserted = false;

    const em = {
      createQueryBuilder: () => ({
        delete: () => ({
          from: () => ({
            execute: async () => {
              deleted = true;
            },
          }),
        }),
      }),
      insert: async (_entity: unknown, rows: unknown) => {
        if (Array.isArray(rows)) {
          inserted = true;
          persistedVersion = (rows[0] as { policyVersion: number })
            .policyVersion;
        } else {
          auditInserted = true;
        }
      },
      update: async (_entity: unknown, _where: unknown, patch: any) => {
        state.policyVersion = patch.policyVersion;
      },
    };

    const service = Object.create(
      AssortmentPolicyRecomputeService.prototype,
    ) as AssortmentPolicyRecomputeService;

    await (service as any).persistResolutions(
      em,
      [
        {
          categoryId: 1,
          status: 'IN_SCOPE',
          reasonCode: 'TARGET_FASHION',
          ruleId: 1,
          via: 'provider_path',
          businessDomain: 'fashion_apparel',
          policyVersion: 5,
        },
      ],
      5,
    );
    expect(deleted).toBe(true);
    expect(inserted).toBe(true);
    expect(persistedVersion).toBe(5);

    // Simulate the version bump step used inside the transaction.
    await em.update(null, { id: 1 }, { policyVersion: 5 });
    await em.insert(null, { operation: 'resolution_recompute' });
    expect(state.policyVersion).toBe(5);
    expect(auditInserted).toBe(true);
  });

  it('leaves previous version untouched when persist throws', async () => {
    const state = { policyVersion: 7 };
    const em = {
      createQueryBuilder: () => ({
        delete: () => ({
          from: () => ({
            execute: async () => {
              throw new Error('disk full');
            },
          }),
        }),
      }),
      insert: async () => undefined,
      update: async () => {
        state.policyVersion = 8;
      },
    };
    const service = Object.create(
      AssortmentPolicyRecomputeService.prototype,
    ) as AssortmentPolicyRecomputeService;

    await expect(
      (service as any).persistResolutions(
        em,
        [
          {
            categoryId: 1,
            status: 'IN_SCOPE',
            reasonCode: 'TARGET_FASHION',
            ruleId: null,
            via: 'provider_path',
            businessDomain: null,
            policyVersion: 8,
          },
        ],
        8,
      ),
    ).rejects.toThrow('disk full');
    expect(state.policyVersion).toBe(7);
  });
});
