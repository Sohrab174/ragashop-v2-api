import {
  evaluateAssortmentPolicy,
  summarizeAssortmentDecisions,
} from './assortment-policy.evaluate';
import { AssortmentPolicyRuleInput } from './assortment-policy.types';
import { normalizePathPrefix } from './assortment-path.normalize';

function rule(
  partial: Partial<AssortmentPolicyRuleInput> &
    Pick<
      AssortmentPolicyRuleInput,
      'id' | 'matchType' | 'status' | 'reasonCode'
    >,
): AssortmentPolicyRuleInput {
  return {
    provider: partial.provider ?? 'trendyol',
    pathPrefixNorm: partial.pathPrefixNorm ?? null,
    categoryId: partial.categoryId ?? null,
    businessDomain: partial.businessDomain ?? null,
    isActive: partial.isActive !== false,
    ...partial,
  };
}

describe('assortment policy evaluator', () => {
  it('gives category override precedence over path prefix', () => {
    const decisions = evaluateAssortmentPolicy({
      policyVersion: 1,
      liveProductCountByCategoryId: { 10: 5 },
      categories: [
        {
          id: 10,
          parentId: null,
          source: 'trendyol',
          hierarchy: 'Giyim/Elbise',
        },
      ],
      rules: [
        rule({
          id: 1,
          matchType: 'path_prefix',
          pathPrefixNorm: normalizePathPrefix('Giyim'),
          status: 'IN_SCOPE',
          reasonCode: 'TARGET_FASHION',
          businessDomain: 'fashion_apparel',
        }),
        rule({
          id: 2,
          matchType: 'category',
          categoryId: 10,
          provider: null,
          status: 'REVIEW_REQUIRED',
          reasonCode: 'SENSITIVE_ADULT',
          businessDomain: 'sensitive',
        }),
      ],
    });
    expect(decisions[0]).toMatchObject({
      status: 'REVIEW_REQUIRED',
      via: 'category_override',
      ruleId: 2,
      reasonCode: 'SENSITIVE_ADULT',
    });
  });

  it('prefers the longest path prefix and ignores row order', () => {
    const categories = [
      {
        id: 1,
        parentId: null,
        source: 'trendyol',
        hierarchy: 'Ev & Mobilya/Mobilya/Halı / Kilim',
      },
    ];
    const rulesA = [
      rule({
        id: 10,
        matchType: 'path_prefix',
        pathPrefixNorm: normalizePathPrefix('Ev & Mobilya/Mobilya'),
        status: 'OUT_OF_SCOPE',
        reasonCode: 'BULKY_FURNITURE',
      }),
      rule({
        id: 11,
        matchType: 'path_prefix',
        pathPrefixNorm: normalizePathPrefix(
          'Ev & Mobilya/Mobilya/Halı / Kilim',
        ),
        status: 'REVIEW_REQUIRED',
        reasonCode: 'HEAVY_TEXTILE_SIZE_UNKNOWN',
      }),
    ];
    const rulesB = [...rulesA].reverse();
    const a = evaluateAssortmentPolicy({
      policyVersion: 1,
      categories,
      rules: rulesA,
      liveProductCountByCategoryId: { 1: 100 },
    });
    const b = evaluateAssortmentPolicy({
      policyVersion: 1,
      categories,
      rules: rulesB,
      liveProductCountByCategoryId: { 1: 100 },
    });
    expect(a[0].status).toBe('REVIEW_REQUIRED');
    expect(a[0].reasonCode).toBe('HEAVY_TEXTILE_SIZE_UNKNOWN');
    expect(a[0].ruleId).toBe(11);
    expect(b[0]).toEqual(a[0]);
  });

  it('fail-safes unknown / incomplete metadata to REVIEW', () => {
    const decisions = evaluateAssortmentPolicy({
      policyVersion: 3,
      categories: [
        { id: 1, parentId: null, source: null, hierarchy: null },
        { id: 2, parentId: null, source: 'trendyol', hierarchy: null },
        { id: 3, parentId: null, source: '', hierarchy: 'Giyim' },
      ],
      rules: [],
      liveProductCountByCategoryId: {},
    });
    for (const d of decisions) {
      expect(d.status).toBe('REVIEW_REQUIRED');
      expect(d.reasonCode).toBe('UNCLASSIFIED');
      expect(d.via).toBe('unclassified');
    }
  });

  it('marks mixed descendant policies as REVIEW', () => {
    const decisions = evaluateAssortmentPolicy({
      policyVersion: 1,
      categories: [
        { id: 1, parentId: null, source: 'trendyol', hierarchy: null },
        {
          id: 2,
          parentId: 1,
          source: 'trendyol',
          hierarchy: 'Giyim/Elbise',
        },
        {
          id: 3,
          parentId: 1,
          source: 'trendyol',
          hierarchy: 'Ev & Mobilya/Mobilya/Koltuk',
        },
      ],
      rules: [
        rule({
          id: 1,
          matchType: 'path_prefix',
          pathPrefixNorm: normalizePathPrefix('Giyim'),
          status: 'IN_SCOPE',
          reasonCode: 'TARGET_FASHION',
        }),
        rule({
          id: 2,
          matchType: 'path_prefix',
          pathPrefixNorm: normalizePathPrefix('Ev & Mobilya/Mobilya'),
          status: 'OUT_OF_SCOPE',
          reasonCode: 'BULKY_FURNITURE',
        }),
      ],
      liveProductCountByCategoryId: { 2: 10, 3: 10 },
    });
    const parent = decisions.find((d) => d.categoryId === 1);
    expect(parent).toMatchObject({
      status: 'REVIEW_REQUIRED',
      reasonCode: 'MIXED_DESCENDANT_POLICY',
      via: 'descendants',
    });
    expect(decisions.find((d) => d.categoryId === 3)?.status).toBe(
      'OUT_OF_SCOPE',
    );
  });

  it('does not let one OUT child force a parent OUT', () => {
    const decisions = evaluateAssortmentPolicy({
      policyVersion: 1,
      categories: [
        { id: 1, parentId: null, source: 'trendyol', hierarchy: null },
        {
          id: 2,
          parentId: 1,
          source: 'trendyol',
          hierarchy: 'Giyim/Elbise',
        },
        {
          id: 3,
          parentId: 1,
          source: 'trendyol',
          hierarchy: 'Ev & Mobilya/Mobilya/Koltuk',
        },
      ],
      rules: [
        rule({
          id: 1,
          matchType: 'path_prefix',
          pathPrefixNorm: normalizePathPrefix('Giyim'),
          status: 'IN_SCOPE',
          reasonCode: 'TARGET_FASHION',
        }),
        rule({
          id: 2,
          matchType: 'path_prefix',
          pathPrefixNorm: normalizePathPrefix('Ev & Mobilya/Mobilya'),
          status: 'OUT_OF_SCOPE',
          reasonCode: 'BULKY_FURNITURE',
        }),
      ],
      liveProductCountByCategoryId: { 2: 100, 3: 1 },
    });
    expect(decisions.find((d) => d.categoryId === 1)?.status).toBe(
      'REVIEW_REQUIRED',
    );
  });

  it('applies domain default only when provided', () => {
    const decisions = evaluateAssortmentPolicy({
      policyVersion: 1,
      categories: [
        {
          id: 9,
          parentId: null,
          source: 'trendyol',
          hierarchy: null,
          engineDomain: 'clothing',
        },
      ],
      rules: [],
      liveProductCountByCategoryId: {},
      domainDefaults: {
        clothing: {
          status: 'IN_SCOPE',
          businessDomain: 'fashion_apparel',
          reasonCode: 'DOMAIN_DEFAULT',
        },
      },
    });
    expect(decisions[0]).toMatchObject({
      status: 'IN_SCOPE',
      via: 'domain_default',
      reasonCode: 'DOMAIN_DEFAULT',
    });
    expect(summarizeAssortmentDecisions(decisions).IN_SCOPE).toBe(1);
  });
});
