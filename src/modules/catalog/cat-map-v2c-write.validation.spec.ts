import {
  MAPPING_HIGH_IMPACT_DEFAULT,
  resolveV2SaveReviewStatus,
  SourceCategoryMappingV2ValidationError,
  validateV2MappingSaveRequest,
} from './cat-map-v2c-write.validation';

function dest(audience: 'women' | 'men' | 'neutral' | 'kids', active = true) {
  return { exists: true, active, rootAudience: audience };
}

describe('CAT-MAP-V2-C write validation', () => {
  const resolveOk = (id: number) => {
    if (id === 20) return dest('women');
    if (id === 40) return dest('men');
    if (id === 56) return dest('neutral');
    if (id === 99)
      return { exists: true, active: false, rootAudience: 'women' as const };
    return null;
  };

  it('female → female destination PASS', () => {
    const rules = validateV2MappingSaveRequest({
      rules: [{ genderSlice: 'female', canonicalCategoryId: 20 }],
      impactProductCount: 10,
      resolveDestination: resolveOk,
    });
    expect(rules).toHaveLength(1);
    expect(rules[0].genderSlice).toBe('female');
  });

  it('male → male destination PASS', () => {
    const rules = validateV2MappingSaveRequest({
      rules: [{ genderSlice: 'male', canonicalCategoryId: 40 }],
      impactProductCount: 10,
      resolveDestination: resolveOk,
    });
    expect(rules[0].genderSlice).toBe('male');
  });

  it('female → male destination REJECT', () => {
    expect(() =>
      validateV2MappingSaveRequest({
        rules: [{ genderSlice: 'female', canonicalCategoryId: 40 }],
        impactProductCount: 10,
        resolveDestination: resolveOk,
      }),
    ).toThrow(SourceCategoryMappingV2ValidationError);
  });

  it('male → female destination REJECT', () => {
    expect(() =>
      validateV2MappingSaveRequest({
        rules: [{ genderSlice: 'male', canonicalCategoryId: 20 }],
        impactProductCount: 10,
        resolveDestination: resolveOk,
      }),
    ).toThrow(/مردانه/);
  });

  it('inactive canonical REJECT', () => {
    try {
      validateV2MappingSaveRequest({
        rules: [{ genderSlice: 'female', canonicalCategoryId: 99 }],
        impactProductCount: 10,
        resolveDestination: resolveOk,
      });
      fail('expected throw');
    } catch (e) {
      expect((e as SourceCategoryMappingV2ValidationError).code).toBe(
        'inactive_canonical',
      );
    }
  });

  it('nonexistent canonical REJECT', () => {
    try {
      validateV2MappingSaveRequest({
        rules: [{ genderSlice: 'female', canonicalCategoryId: 404 }],
        impactProductCount: 10,
        resolveDestination: resolveOk,
      });
      fail('expected throw');
    } catch (e) {
      expect((e as SourceCategoryMappingV2ValidationError).code).toBe(
        'invalid_canonical',
      );
    }
  });

  it('duplicate female rules REJECT', () => {
    expect(() =>
      validateV2MappingSaveRequest({
        rules: [
          { genderSlice: 'female', canonicalCategoryId: 20 },
          { genderSlice: 'female', canonicalCategoryId: 21 },
        ],
        impactProductCount: 10,
        resolveDestination: resolveOk,
      }),
    ).toThrow(/تکراری/);
  });

  it('unknown slice REJECT', () => {
    expect(() =>
      validateV2MappingSaveRequest({
        rules: [{ genderSlice: 'unknown', canonicalCategoryId: 20 }],
        impactProductCount: 10,
        resolveDestination: resolveOk,
      }),
    ).toThrow(/unknown/);
  });

  it('unisex slice REJECT by default launch policy', () => {
    expect(() =>
      validateV2MappingSaveRequest({
        rules: [{ genderSlice: 'unisex', canonicalCategoryId: 56 }],
        impactProductCount: 10,
        resolveDestination: resolveOk,
      }),
    ).toThrow(/unisex/);
  });

  it('any slice REJECT when allowNeutralAny is false', () => {
    expect(() =>
      validateV2MappingSaveRequest({
        rules: [{ genderSlice: 'any', canonicalCategoryId: 56 }],
        impactProductCount: 10,
        resolveDestination: resolveOk,
        allowNeutralAny: false,
      }),
    ).toThrow(/any/);
  });

  it('high-impact without confirm REJECT', () => {
    try {
      validateV2MappingSaveRequest({
        rules: [
          { genderSlice: 'female', canonicalCategoryId: 20 },
          { genderSlice: 'male', canonicalCategoryId: 40 },
        ],
        impactProductCount: MAPPING_HIGH_IMPACT_DEFAULT,
        confirmImpact: false,
        resolveDestination: resolveOk,
      });
      fail('expected throw');
    } catch (e) {
      const err = e as SourceCategoryMappingV2ValidationError;
      expect(err.code).toBe('confirm_required');
      expect(err.details?.confirmImpactRequired).toBe(true);
      expect(err.details?.impactProductCount).toBe(MAPPING_HIGH_IMPACT_DEFAULT);
    }
  });

  it('high-impact with confirm PASS', () => {
    const rules = validateV2MappingSaveRequest({
      rules: [
        { genderSlice: 'female', canonicalCategoryId: 20 },
        { genderSlice: 'male', canonicalCategoryId: 40 },
      ],
      impactProductCount: 5000,
      confirmImpact: true,
      resolveDestination: resolveOk,
    });
    expect(rules).toHaveLength(2);
  });

  it('validates all rules before returning (no partial acceptance)', () => {
    expect(() =>
      validateV2MappingSaveRequest({
        rules: [
          { genderSlice: 'female', canonicalCategoryId: 20 },
          { genderSlice: 'male', canonicalCategoryId: 20 }, // bad audience
        ],
        impactProductCount: 10,
        confirmImpact: true,
        resolveDestination: resolveOk,
      }),
    ).toThrow(SourceCategoryMappingV2ValidationError);
  });

  it('reviewStatus: legacy transition → migrated; fresh → reviewed_ok', () => {
    expect(resolveV2SaveReviewStatus({ hadActiveLegacyAny: true })).toBe(
      'migrated',
    );
    expect(resolveV2SaveReviewStatus({ hadActiveLegacyAny: false })).toBe(
      'reviewed_ok',
    );
  });
});
