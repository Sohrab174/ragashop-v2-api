import {
  AssortmentPolicyAdminValidationError,
  assertValidAssortmentStatus,
  diffAssortmentDecisions,
  summarizeAssortmentImpact,
  withHypotheticalCategoryOverride,
} from './assortment-policy.impact';
import { evaluateAssortmentPolicy } from './assortment-policy.evaluate';
import { normalizePathPrefix } from './assortment-path.normalize';

describe('SCOPE-5/6 operational impact', () => {
  const change = (
    categoryId: number,
    fromStatus: string | null,
    toStatus: string,
    liveProducts: number,
    discoverableProducts: number,
  ) => ({
    categoryId,
    fromStatus,
    toStatus,
    fromReasonCode: null,
    toReasonCode: 'X',
    fromVia: null,
    toVia: 'override',
    liveProducts,
    discoverableProducts,
  });

  it('reports hidden / losing purchase / refresh stopped / reactivation', () => {
    const impact = summarizeAssortmentImpact({
      changes: [
        change(1, 'IN_SCOPE', 'OUT_OF_SCOPE', 100, 80),
        change(2, 'IN_SCOPE', 'REVIEW_REQUIRED', 10, 5),
        change(3, 'REVIEW_REQUIRED', 'IN_SCOPE', 40, 0),
        change(4, 'REVIEW_REQUIRED', 'OUT_OF_SCOPE', 7, 0),
      ],
      highImpactThreshold: 10_000,
    });
    expect(impact.operational).toEqual({
      productsBecomingHidden: 85,
      productsLosingPurchase: 110,
      refreshCandidatesStopped: 110,
      productsPotentiallyReactivated: 40,
      categoriesReactivated: 1,
    });
  });

  it('no changes → all zero', () => {
    const impact = summarizeAssortmentImpact({ changes: [] });
    expect(Object.values(impact.operational).every((v) => v === 0)).toBe(true);
  });
});

describe('assortment impact preview (pure)', () => {
  const baseRules = [
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
  ];
  const categories = [
    {
      id: 10,
      parentId: null,
      source: 'trendyol',
      hierarchy: 'Giyim/Elbise',
    },
  ];

  it('preview override changes status without needing DB', () => {
    const current = evaluateAssortmentPolicy({
      categories,
      rules: baseRules,
      liveProductCountByCategoryId: { 10: 20 },
      policyVersion: 1,
    });
    expect(current[0].status).toBe('IN_SCOPE');

    const hypo = withHypotheticalCategoryOverride({
      rules: baseRules,
      categoryId: 10,
      targetStatus: 'OUT_OF_SCOPE',
    });
    const proposed = evaluateAssortmentPolicy({
      categories,
      rules: hypo as any,
      liveProductCountByCategoryId: { 10: 20 },
      policyVersion: 2,
    });
    expect(proposed[0].status).toBe('OUT_OF_SCOPE');
    expect(proposed[0].via).toBe('category_override');

    const changes = diffAssortmentDecisions({
      previous: current,
      proposed,
      discoverableByCategoryId: { 10: 600 },
    });
    expect(changes).toHaveLength(1);
    const impact = summarizeAssortmentImpact({
      changes,
      mappingCountByCategoryId: { 10: 1 },
      orderItemCountByCategoryId: { 10: 2 },
      highImpactThreshold: 500,
    });
    expect(impact.confirmationRequired).toBe(true);
    expect(impact.highRiskReasons).toEqual(
      expect.arrayContaining([
        'in_to_out_high_products',
        'in_to_out_order_history',
        'in_leaving_with_active_mapping',
      ]),
    );
    expect(impact.impactedDiscoverableProductCount).toBe(600);
  });

  it('low-impact REVIEW decision does not require confirmation', () => {
    const changes = [
      {
        categoryId: 10,
        fromStatus: 'REVIEW_REQUIRED',
        toStatus: 'IN_SCOPE',
        fromReasonCode: 'UNCLASSIFIED',
        toReasonCode: 'EMPLOYEE_OVERRIDE',
        fromVia: 'unclassified',
        toVia: 'category_override',
        liveProducts: 3,
        discoverableProducts: 3,
      },
    ];
    const impact = summarizeAssortmentImpact({
      changes,
      highImpactThreshold: 500,
    });
    expect(impact.confirmationRequired).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(() => assertValidAssortmentStatus('YES')).toThrow(
      AssortmentPolicyAdminValidationError,
    );
  });

  it('updates existing override in place in the hypothetical list', () => {
    const withOverride = withHypotheticalCategoryOverride({
      rules: baseRules,
      categoryId: 10,
      targetStatus: 'REVIEW_REQUIRED',
    });
    const again = withHypotheticalCategoryOverride({
      rules: withOverride as any,
      categoryId: 10,
      targetStatus: 'IN_SCOPE',
    });
    const overrides = again.filter(
      (r) => r.matchType === 'category' && r.categoryId === 10,
    );
    expect(overrides).toHaveLength(1);
    expect(overrides[0].status).toBe('IN_SCOPE');
  });
});
