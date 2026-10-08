import {
  accumulateProductGender,
  classifyLegacyMapping,
  emptyDistribution,
  resolveCanonicalRoot,
} from './cat-map-v2a-classification';

describe('cat-map-v2a-classification (read-only)', () => {
  it('classifies clean women mapping as SAFE_SINGLE_AUDIENCE', () => {
    const dist = emptyDistribution();
    for (let i = 0; i < 100; i++) accumulateProductGender(dist, 'female');
    const result = classifyLegacyMapping({
      rootAudience: 'women',
      distribution: dist,
    });
    expect(result.classification).toBe('SAFE_SINGLE_AUDIENCE');
  });

  it('classifies mixed men mapping as MIXED_REVIEW_REQUIRED', () => {
    const dist = emptyDistribution();
    for (let i = 0; i < 50; i++) accumulateProductGender(dist, 'male');
    for (let i = 0; i < 50; i++) accumulateProductGender(dist, 'female');
    const result = classifyLegacyMapping({
      rootAudience: 'men',
      distribution: dist,
    });
    expect(result.classification).toBe('MIXED_REVIEW_REQUIRED');
  });

  it('classifies neutral root as NEUTRAL', () => {
    const dist = emptyDistribution();
    accumulateProductGender(dist, 'female');
    accumulateProductGender(dist, 'male');
    expect(
      classifyLegacyMapping({ rootAudience: 'neutral', distribution: dist })
        .classification,
    ).toBe('NEUTRAL');
  });

  it('classifies empty scope as UNKNOWN', () => {
    expect(
      classifyLegacyMapping({
        rootAudience: 'women',
        distribution: emptyDistribution(),
      }).classification,
    ).toBe('UNKNOWN');
  });

  it('resolves canonical root audience from field then name', () => {
    const rows = [
      { id: 1, parentId: null, name: 'زنانه', audience: 'female' },
      { id: 20, parentId: 1, name: 'بلوز', audience: null },
    ];
    expect(resolveCanonicalRoot(20, rows).rootAudience).toBe('women');
    expect(resolveCanonicalRoot(20, rows).rootName).toBe('زنانه');
  });
});
