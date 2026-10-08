import {
  AssortmentPolicyRuleValidationError,
  findDuplicateActiveSelectors,
  validateAssortmentRuleDraft,
} from './assortment-policy.validate';

describe('assortment policy rule validation', () => {
  it('rejects invalid selector combinations', () => {
    expect(() =>
      validateAssortmentRuleDraft({
        provider: 'trendyol',
        matchType: 'path_prefix',
        pathPrefix: 'Giyim',
        categoryId: 12,
        status: 'IN_SCOPE',
        reasonCode: 'TARGET_FASHION',
        businessDomain: 'fashion_apparel',
      }),
    ).toThrow(AssortmentPolicyRuleValidationError);

    expect(() =>
      validateAssortmentRuleDraft({
        provider: null,
        matchType: 'category',
        pathPrefix: 'Giyim',
        categoryId: 12,
        status: 'IN_SCOPE',
        reasonCode: 'TARGET_FASHION',
        businessDomain: null,
      }),
    ).toThrow(AssortmentPolicyRuleValidationError);

    expect(() =>
      validateAssortmentRuleDraft({
        provider: 'trendyol',
        matchType: 'path_prefix',
        pathPrefix: '',
        categoryId: null,
        status: 'IN_SCOPE',
        reasonCode: 'TARGET_FASHION',
        businessDomain: null,
      }),
    ).toThrow(AssortmentPolicyRuleValidationError);
  });

  it('builds deterministic selector keys', () => {
    const path = validateAssortmentRuleDraft({
      provider: 'trendyol',
      matchType: 'path_prefix',
      pathPrefix: 'Giyim/Elbise',
      categoryId: null,
      status: 'IN_SCOPE',
      reasonCode: 'TARGET_FASHION',
      businessDomain: 'fashion_apparel',
    });
    expect(path.selectorKey).toBe('path:trendyol:giyim/elbise');
    expect(path.pathPrefixNorm).toBe('giyim/elbise');

    const cat = validateAssortmentRuleDraft({
      provider: null,
      matchType: 'category',
      pathPrefix: null,
      categoryId: 42,
      status: 'OUT_OF_SCOPE',
      reasonCode: 'BULKY_FURNITURE',
      businessDomain: 'home_furniture',
    });
    expect(cat.selectorKey).toBe('category:42');
    expect(cat.pathPrefixNorm).toBeNull();
  });

  it('detects duplicate active selectors', () => {
    const dupes = findDuplicateActiveSelectors([
      { selectorKey: 'path:trendyol:giyim', isActive: true, id: 1 },
      { selectorKey: 'path:trendyol:giyim', isActive: true, id: 2 },
      { selectorKey: 'path:trendyol:giyim', isActive: false, id: 3 },
      { selectorKey: 'category:9', isActive: true, id: 4 },
    ]);
    expect(dupes).toEqual(['path:trendyol:giyim']);
  });
});
