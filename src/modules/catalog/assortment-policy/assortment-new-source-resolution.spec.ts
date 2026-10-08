/**
 * SCOPE-7 — newly created source categories must resolve via the central
 * evaluator (not parent inheritance). English furniture paths that do not
 * match seeded Turkish path rules fail safe to REVIEW / UNCLASSIFIED.
 */
import { evaluateAssortmentPolicy } from './assortment-policy.evaluate';
import { normalizePathPrefix } from './assortment-path.normalize';
import { AssortmentPolicyRecomputeService } from './assortment-policy.recompute.service';
import {
  AssortmentCategoryInput,
  AssortmentPolicyRuleInput,
} from './assortment-policy.types';

const baseRules: AssortmentPolicyRuleInput[] = [
  {
    id: 1,
    provider: 'trendyol',
    matchType: 'path_prefix',
    pathPrefixNorm: normalizePathPrefix('Giyim'),
    categoryId: null,
    status: 'IN_SCOPE',
    reasonCode: 'TARGET_FASHION',
    businessDomain: 'fashion_apparel',
    isActive: true,
  },
  {
    id: 2,
    provider: 'trendyol',
    matchType: 'path_prefix',
    pathPrefixNorm: normalizePathPrefix('Ev & Mobilya/Mobilya'),
    categoryId: null,
    status: 'OUT_OF_SCOPE',
    reasonCode: 'BULKY_FURNITURE',
    businessDomain: 'home_furniture',
    isActive: true,
  },
  {
    id: 3,
    provider: 'trendyol',
    matchType: 'path_prefix',
    pathPrefixNorm: normalizePathPrefix('Ev & Mobilya/Ev'),
    categoryId: null,
    status: 'REVIEW_REQUIRED',
    reasonCode: 'HOME_GOODS_NOT_YET_DECIDED',
    businessDomain: 'home_goods_small',
    isActive: true,
  },
];

function decide(
  categories: AssortmentCategoryInput[],
  extraRules: AssortmentPolicyRuleInput[] = [],
) {
  return evaluateAssortmentPolicy({
    policyVersion: 1,
    categories,
    rules: [...baseRules, ...extraRules],
    liveProductCountByCategoryId: Object.fromEntries(
      categories.map((c) => [c.id, 0]),
    ),
  });
}

describe('SCOPE-7 new-source category resolution (evaluator)', () => {
  it('new child under matching OUT Turkish path resolves OUT via provider_path', () => {
    const decisions = decide([
      {
        id: 465,
        parentId: null,
        source: 'trendyol',
        hierarchy:
          'Ev & Mobilya/Mobilya/Salon & Oturma Odası/Kanepe & Koltuklar/Koltuk Takımı',
      },
      {
        id: 2000,
        parentId: 465,
        source: 'trendyol',
        hierarchy:
          'Ev & Mobilya/Mobilya/Salon & Oturma Odası/Kanepe & Koltuklar/Koltuk Takımı/Yeni',
      },
    ]);
    const child = decisions.find((d) => d.categoryId === 2000)!;
    expect(child.status).toBe('OUT_OF_SCOPE');
    expect(child.via).toBe('provider_path');
    expect(child.reasonCode).toBe('BULKY_FURNITURE');
  });

  it('new child under matching IN path resolves IN', () => {
    const decisions = decide([
      {
        id: 10,
        parentId: null,
        source: 'trendyol',
        hierarchy: 'Giyim/Pantolon',
      },
    ]);
    expect(decisions[0]).toMatchObject({
      status: 'IN_SCOPE',
      via: 'provider_path',
      reasonCode: 'TARGET_FASHION',
    });
  });

  it('new child under matching REVIEW path resolves REVIEW', () => {
    const decisions = decide([
      {
        id: 20,
        parentId: null,
        source: 'trendyol',
        hierarchy: 'Ev & Mobilya/Ev/Mutfak',
      },
    ]);
    expect(decisions[0]).toMatchObject({
      status: 'REVIEW_REQUIRED',
      via: 'provider_path',
      reasonCode: 'HOME_GOODS_NOT_YET_DECIDED',
    });
  });

  it('explicit child override wins over ancestor/path rule', () => {
    const decisions = decide(
      [
        {
          id: 30,
          parentId: null,
          source: 'trendyol',
          hierarchy: 'Ev & Mobilya/Mobilya/Exception Leaf',
        },
      ],
      [
        {
          id: 99,
          provider: 'trendyol',
          matchType: 'category',
          pathPrefixNorm: null,
          categoryId: 30,
          status: 'IN_SCOPE',
          reasonCode: 'HUMAN_OVERRIDE_IN',
          businessDomain: 'fashion_apparel',
          isActive: true,
        },
      ],
    );
    expect(decisions[0]).toMatchObject({
      status: 'IN_SCOPE',
      via: 'category_override',
      reasonCode: 'HUMAN_OVERRIDE_IN',
      ruleId: 99,
    });
  });

  it('English Home & Furniture child (like Sofa Set 1019) fails safe to REVIEW, not OUT', () => {
    const decisions = decide([
      {
        id: 465,
        parentId: null,
        source: 'trendyol',
        hierarchy:
          'Ev & Mobilya/Mobilya/Salon & Oturma Odası/Kanepe & Koltuklar/Koltuk Takımı',
      },
      {
        id: 1019,
        parentId: 465,
        source: 'trendyol',
        hierarchy:
          'Home & Furniture/Furniture/Lounge & Living Room/Sofas & Armchairs/Sofa Set',
      },
    ]);
    const sofa = decisions.find((d) => d.categoryId === 1019)!;
    const parent = decisions.find((d) => d.categoryId === 465)!;
    expect(parent.status).toBe('OUT_OF_SCOPE');
    expect(sofa.status).toBe('REVIEW_REQUIRED');
    expect(sofa.via).toBe('unclassified');
    expect(sofa.reasonCode).toBe('UNCLASSIFIED');
  });

  it('ambiguous new child without path/override fails safe to REVIEW (never auto-OUT)', () => {
    const decisions = decide([
      {
        id: 50,
        parentId: null,
        source: 'trendyol',
        hierarchy: 'Unknown Domain/Widget',
      },
    ]);
    expect(decisions[0]).toMatchObject({
      status: 'REVIEW_REQUIRED',
      via: 'unclassified',
      reasonCode: 'UNCLASSIFIED',
    });
  });

  it('materializeMissingResolutions is a no-op when nothing is missing', async () => {
    const service = Object.create(
      AssortmentPolicyRecomputeService.prototype,
    ) as AssortmentPolicyRecomputeService;
    (service as any).countMissingResolutions = jest.fn(async () => 0);
    (service as any).stateRepo = {
      findOne: jest.fn(async () => ({ id: 1, policyVersion: 2 })),
    };
    (service as any).recompute = jest.fn();

    const out = await service.materializeMissingResolutions('test');
    expect(out.changed).toBe(false);
    expect(out.missingBefore).toBe(0);
    expect(out.policyVersion).toBe(2);
    expect((service as any).recompute).not.toHaveBeenCalled();
  });

  it('materializeMissingResolutions recomputes once when a gap exists', async () => {
    const service = Object.create(
      AssortmentPolicyRecomputeService.prototype,
    ) as AssortmentPolicyRecomputeService;
    (service as any).countMissingResolutions = jest.fn(async () => 1);
    (service as any).recompute = jest.fn(async () => ({
      previousVersion: 2,
      policyVersion: 3,
      categoryCount: 661,
      ruleCount: 28,
      byStatus: { REVIEW_REQUIRED: 214 },
      changedCategoryIds: [1019],
      changed: true,
    }));

    const out = await service.materializeMissingResolutions('test');
    expect(out.changed).toBe(true);
    expect(out.missingBefore).toBe(1);
    expect(out.policyVersion).toBe(3);
    expect((service as any).recompute).toHaveBeenCalledTimes(1);
  });
});
