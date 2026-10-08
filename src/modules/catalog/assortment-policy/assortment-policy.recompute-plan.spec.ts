import {
  activeRuleFingerprint,
  diffResolutions,
  planAssortmentRecompute,
} from './assortment-policy.recompute-plan';
import { AssortmentPolicyRecomputeService } from './assortment-policy.recompute.service';
import { AssortmentPolicyRuleEntity } from './entities/assortment-policy-rule.entity';
import { CategoryAssortmentResolutionEntity } from './entities/category-assortment-resolution.entity';
import { CategoryEntity } from '../../category/entities/category.entity';
import { normalizePathPrefix } from './assortment-path.normalize';

const rule = (over: Record<string, unknown> = {}) => ({
  id: 1,
  provider: 'trendyol',
  matchType: 'path_prefix' as const,
  pathPrefixNorm: normalizePathPrefix('Giyim'),
  categoryId: null,
  status: 'IN_SCOPE' as const,
  reasonCode: 'TARGET_FASHION',
  businessDomain: 'fashion_apparel',
  isActive: true,
  ...over,
});

const res = (over: Record<string, unknown> = {}) => ({
  categoryId: 10,
  status: 'IN_SCOPE',
  reasonCode: 'TARGET_FASHION',
  ruleId: 1,
  via: 'provider_path',
  businessDomain: 'fashion_apparel',
  ...over,
});

describe('planAssortmentRecompute (policy version semantics)', () => {
  it('no-op: unchanged rules + unchanged resolutions keep the version', () => {
    const rules = [rule()];
    const plan = planAssortmentRecompute({
      previousVersion: 2,
      previousResolutions: [res()],
      decisions: [{ ...(res() as any), policyVersion: 3 }],
      rules,
      lastRuleFingerprint: activeRuleFingerprint(rules),
    });
    expect(plan.changed).toBe(false);
    expect(plan.policyVersion).toBe(2);
    expect(plan.changedCategoryIds).toEqual([]);
  });

  it('no-op when legacy recompute audit has no fingerprint and nothing changed', () => {
    const plan = planAssortmentRecompute({
      previousVersion: 2,
      previousResolutions: [res()],
      decisions: [{ ...(res() as any), policyVersion: 3 }],
      rules: [rule()],
      lastRuleFingerprint: null,
    });
    expect(plan.changed).toBe(false);
    expect(plan.policyVersion).toBe(2);
  });

  it('resolution change advances version by exactly one', () => {
    const plan = planAssortmentRecompute({
      previousVersion: 2,
      previousResolutions: [res()],
      decisions: [
        {
          ...(res({ status: 'REVIEW_REQUIRED', via: 'category_override', ruleId: 9 }) as any),
          policyVersion: 3,
        },
      ],
      rules: [rule()],
    });
    expect(plan.changed).toBe(true);
    expect(plan.policyVersion).toBe(3);
    expect(plan.changedCategoryIds).toEqual([10]);
  });

  it('explicit rulesChanged advances even when resolutions are identical', () => {
    const plan = planAssortmentRecompute({
      previousVersion: 5,
      previousResolutions: [res()],
      decisions: [{ ...(res() as any), policyVersion: 6 }],
      rules: [rule()],
      rulesChanged: true,
    });
    expect(plan.changed).toBe(true);
    expect(plan.policyVersion).toBe(6);
  });

  it('fingerprint drift (rule edited elsewhere) advances version', () => {
    const plan = planAssortmentRecompute({
      previousVersion: 5,
      previousResolutions: [res()],
      decisions: [{ ...(res() as any), policyVersion: 6 }],
      rules: [rule({ reasonCode: 'TARGET_ACCESSORY' })],
      lastRuleFingerprint: activeRuleFingerprint([rule()]),
    });
    expect(plan.rulesChanged).toBe(true);
    expect(plan.policyVersion).toBe(6);
  });

  it('fingerprint ignores inactive rules and order', () => {
    const a = activeRuleFingerprint([rule({ id: 2 }), rule({ id: 1 })]);
    const b = activeRuleFingerprint([
      rule({ id: 1 }),
      rule({ id: 2 }),
      rule({ id: 3, isActive: false }),
    ]);
    expect(a).toBe(b);
  });

  it('diff reports removed categories', () => {
    const d = diffResolutions([res(), res({ categoryId: 11 })], [res()]);
    expect(d.removedCategoryIds).toEqual([11]);
    expect(d.changedCategoryIds).toEqual([]);
  });
});

function makeRecomputeEm(opts: {
  version: number;
  rules: any[];
  categories: any[];
  resolutions: any[];
  lastAfterJson?: unknown;
}) {
  const calls = { update: [] as any[], insert: [] as any[], deleted: false };
  const em: any = {
    query: async (sql: string) => {
      if (/FROM assortment_policy_state/.test(sql))
        return [{ policyVersion: opts.version }];
      if (/FROM product/.test(sql))
        return opts.categories.map((c) => ({ categoryId: c.id, live: 3 }));
      if (/FROM assortment_policy_audit/.test(sql))
        return opts.lastAfterJson === undefined
          ? []
          : [{ afterJson: opts.lastAfterJson }];
      return [];
    },
    find: async (entity: unknown) => {
      if (entity === AssortmentPolicyRuleEntity) return opts.rules;
      if (entity === CategoryEntity) return opts.categories;
      if (entity === CategoryAssortmentResolutionEntity)
        return opts.resolutions;
      return [];
    },
    update: async (_e: unknown, _w: unknown, patch: any) => {
      calls.update.push(patch);
    },
    insert: async (_e: unknown, rows: any) => {
      calls.insert.push(rows);
    },
    createQueryBuilder: () => ({
      delete: () => ({
        from: () => ({
          execute: async () => {
            calls.deleted = true;
          },
        }),
      }),
    }),
  };
  return { em, calls };
}

describe('AssortmentPolicyRecomputeService.recomputeWithin idempotency', () => {
  const categories = [
    { id: 10, parentId: null, source: 'trendyol', hierarchy: 'Giyim/Elbise' },
  ];
  const service = Object.create(
    AssortmentPolicyRecomputeService.prototype,
  ) as AssortmentPolicyRecomputeService;

  it('does not write or bump version when nothing changed', async () => {
    const { em, calls } = makeRecomputeEm({
      version: 2,
      rules: [rule()],
      categories,
      resolutions: [res()],
    });
    const out = await service.recomputeWithin(em, 'test');
    expect(out.changed).toBe(false);
    expect(out.policyVersion).toBe(2);
    expect(calls.deleted).toBe(false);
    expect(calls.update).toHaveLength(0);
    expect(calls.insert).toHaveLength(0);
  });

  it('persists, bumps once and audits when an override changes a resolution', async () => {
    const { em, calls } = makeRecomputeEm({
      version: 2,
      rules: [
        rule(),
        rule({
          id: 7,
          matchType: 'category',
          pathPrefixNorm: null,
          categoryId: 10,
          provider: null,
          status: 'REVIEW_REQUIRED',
          reasonCode: 'HOME_GOODS_NOT_YET_DECIDED',
          businessDomain: null,
        }),
      ],
      categories,
      resolutions: [res()],
    });
    const out = await service.recomputeWithin(em, 'test', {
      rulesChanged: true,
    });
    expect(out.changed).toBe(true);
    expect(out.policyVersion).toBe(3);
    expect(out.changedCategoryIds).toEqual([10]);
    expect(calls.deleted).toBe(true);
    expect(calls.update[0].policyVersion).toBe(3);
    const audit = calls.insert.find((r) => !Array.isArray(r));
    expect(audit.operation).toBe('resolution_recompute');
    expect(audit.afterJson.ruleFingerprint).toMatch(/^[0-9a-f]{64}$/);
    const rows = calls.insert.find((r) => Array.isArray(r));
    expect(rows[0]).toMatchObject({
      categoryId: 10,
      status: 'REVIEW_REQUIRED',
      via: 'category_override',
      policyVersion: 3,
    });
  });

  it('running twice with the same state is idempotent', async () => {
    const rules = [rule()];
    const first = makeRecomputeEm({
      version: 4,
      rules,
      categories,
      resolutions: [res()],
      lastAfterJson: JSON.stringify({
        ruleFingerprint: activeRuleFingerprint(rules),
      }),
    });
    const a = await service.recomputeWithin(first.em, 'test');
    const b = await service.recomputeWithin(first.em, 'test');
    expect(a.policyVersion).toBe(4);
    expect(b.policyVersion).toBe(4);
    expect(first.calls.update).toHaveLength(0);
  });
});
