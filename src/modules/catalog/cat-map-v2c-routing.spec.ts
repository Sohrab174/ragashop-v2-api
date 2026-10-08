import {
  classifySourceCategoryScope,
  resolveMappingRoutingStatus,
} from './cat-map-v2c-routing';

const dist = (female: number, male: number, unisex = 0, unknown = 0) => ({
  total: female + male + unisex + unknown,
  female,
  male,
  unisex,
  unknown,
});

describe('CAT-MAP-V2-C routingStatus', () => {
  it('UNMAPPED when no active rules', () => {
    expect(
      resolveMappingRoutingStatus({
        distribution: dist(10, 5),
        rules: [],
        classification: 'MIXED_REVIEW_REQUIRED',
      }),
    ).toBe('UNMAPPED');
  });

  it('legacy any mixed → UNREVIEWED, never COMPLETE', () => {
    expect(
      resolveMappingRoutingStatus({
        distribution: dist(4625, 2661, 39, 404), // total 7729
        rules: [
          {
            genderSlice: 'any',
            status: 'active',
            reviewStatus: 'legacy_unreviewed',
            canonicalCategoryId: 40,
            canonicalAudience: 'men',
          },
        ],
        classification: 'MIXED_REVIEW_REQUIRED',
      }),
    ).toBe('UNREVIEWED');
  });

  it('mixed with only female reviewed → PARTIAL', () => {
    expect(
      resolveMappingRoutingStatus({
        distribution: dist(100, 80),
        rules: [
          {
            genderSlice: 'female',
            status: 'active',
            reviewStatus: 'reviewed_ok',
            canonicalCategoryId: 20,
            canonicalAudience: 'women',
          },
        ],
        classification: 'MIXED_REVIEW_REQUIRED',
      }),
    ).toBe('PARTIAL');
  });

  it('mixed with female+male reviewed → COMPLETE', () => {
    expect(
      resolveMappingRoutingStatus({
        distribution: dist(100, 80),
        rules: [
          {
            genderSlice: 'female',
            status: 'active',
            reviewStatus: 'reviewed_ok',
            canonicalCategoryId: 20,
            canonicalAudience: 'women',
          },
          {
            genderSlice: 'male',
            status: 'active',
            reviewStatus: 'migrated',
            canonicalCategoryId: 40,
            canonicalAudience: 'men',
          },
        ],
        classification: 'MIXED_REVIEW_REQUIRED',
      }),
    ).toBe('COMPLETE');
  });

  it('safe single female with reviewed female → COMPLETE', () => {
    expect(
      resolveMappingRoutingStatus({
        distribution: dist(1000, 0),
        rules: [
          {
            genderSlice: 'female',
            status: 'active',
            reviewStatus: 'reviewed_ok',
            canonicalCategoryId: 20,
            canonicalAudience: 'women',
          },
        ],
        classification: 'SAFE_SINGLE_AUDIENCE',
      }),
    ).toBe('COMPLETE');
  });

  it('neutral reviewed any → COMPLETE', () => {
    expect(
      resolveMappingRoutingStatus({
        distribution: dist(10, 10, 5, 2),
        rules: [
          {
            genderSlice: 'any',
            status: 'active',
            reviewStatus: 'reviewed_ok',
            canonicalCategoryId: 56,
            canonicalAudience: 'neutral',
          },
        ],
        classification: 'NEUTRAL',
      }),
    ).toBe('COMPLETE');
  });

  it('needs_review status wins', () => {
    expect(
      resolveMappingRoutingStatus({
        distribution: dist(10, 10),
        rules: [
          {
            genderSlice: 'female',
            status: 'active',
            reviewStatus: 'needs_review',
            canonicalCategoryId: 20,
            canonicalAudience: 'women',
          },
        ],
        classification: 'MIXED_REVIEW_REQUIRED',
      }),
    ).toBe('NEEDS_REVIEW');
  });
});

describe('CAT-MAP-V2-C source classification', () => {
  it('uses destination audience when present (legacy mixed under men)', () => {
    const r = classifySourceCategoryScope({
      distribution: dist(4625, 2661, 39, 404),
      destinationRootAudience: 'men',
    });
    expect(r.classification).toBe('MIXED_REVIEW_REQUIRED');
  });

  it('infers MIXED from distribution when unmapped', () => {
    const r = classifySourceCategoryScope({
      distribution: dist(100, 80),
      destinationRootAudience: null,
    });
    expect(r.classification).toBe('MIXED_REVIEW_REQUIRED');
  });

  it('SAFE when single audience and strong match', () => {
    const r = classifySourceCategoryScope({
      distribution: dist(1000, 0),
      destinationRootAudience: 'women',
    });
    expect(r.classification).toBe('SAFE_SINGLE_AUDIENCE');
  });

  it('UNKNOWN when empty', () => {
    expect(
      classifySourceCategoryScope({
        distribution: dist(0, 0),
        destinationRootAudience: null,
      }).classification,
    ).toBe('UNKNOWN');
  });
});
