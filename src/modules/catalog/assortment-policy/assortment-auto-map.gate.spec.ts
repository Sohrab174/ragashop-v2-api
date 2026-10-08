import {
  buildAssortmentAwareCoverage,
  classifyLegacyMappingsByAssortment,
  filterMappingEligibleIds,
  isMappingEligibleStatus,
  resolveAssortmentGate,
} from './assortment-auto-map.gate';

describe('assortment AUTO-MAP gate', () => {
  it('IN → mapping eligible; REVIEW → assortment queue; OUT → stop', () => {
    expect(resolveAssortmentGate('IN_SCOPE')).toMatchObject({
      action: 'AUTO_MAP_ELIGIBLE',
      mappingEligible: true,
    });
    expect(resolveAssortmentGate('REVIEW_REQUIRED')).toMatchObject({
      action: 'ASSORTMENT_QUEUE',
      mappingEligible: false,
      assortmentQueueEligible: true,
    });
    expect(resolveAssortmentGate('OUT_OF_SCOPE')).toMatchObject({
      action: 'STOP_OUT_OF_SCOPE',
      mappingEligible: false,
      assortmentQueueEligible: false,
    });
  });

  it('missing resolution fails closed to assortment queue (never OUT)', () => {
    const g = resolveAssortmentGate(null);
    expect(g.action).toBe('ASSORTMENT_QUEUE');
    expect(g.mappingEligible).toBe(false);
  });

  it('filters mapping-eligible ids to IN only', () => {
    const map = new Map([
      [1, 'IN_SCOPE'],
      [2, 'REVIEW_REQUIRED'],
      [3, 'OUT_OF_SCOPE'],
    ]);
    expect(filterMappingEligibleIds([1, 2, 3, 4], map)).toEqual([1]);
    expect(isMappingEligibleStatus('REVIEW_REQUIRED')).toBe(false);
  });

  it('coverage denominator is IN discoverable only', () => {
    const cov = buildAssortmentAwareCoverage({
      totalDiscoverable: 67180,
      byStatus: {
        IN_SCOPE: { categories: 375, discoverableProducts: 55035 },
        REVIEW_REQUIRED: { categories: 213, discoverableProducts: 11271 },
        OUT_OF_SCOPE: { categories: 72, discoverableProducts: 874 },
      },
      inScopeMissingDestination: {
        categories: 35,
        discoverableProducts: 11168,
      },
      autoMapHighRoutable: 24125,
      autoMapHighSuggestRoutable: 33638,
    });
    expect(cov.products.inScopeDiscoverable).toBe(55035);
    expect(cov.percents.autoMapHighOfInScope).toBe(43.84);
    expect(cov.percents.autoMapHighSuggestOfInScope).toBe(61.12);
    expect(cov.categories.inScopeMissingDestination).toBe(35);
    expect(cov.products.inScopeMissingDestinationProducts).toBe(11168);
  });

  it('classifies legacy mappings without mutating them', () => {
    const out = classifyLegacyMappingsByAssortment({
      mappings: [
        { id: 1, sourceCategoryId: 10 },
        { id: 2, sourceCategoryId: 20 },
        { id: 3, sourceCategoryId: 30 },
        { id: 4, sourceCategoryId: 99 },
      ],
      statusByCategoryId: {
        10: 'IN_SCOPE',
        20: 'REVIEW_REQUIRED',
        30: 'OUT_OF_SCOPE',
      },
    });
    expect(out.byStatus.IN_SCOPE.count).toBe(1);
    expect(out.byStatus.REVIEW_REQUIRED.count).toBe(1);
    expect(out.byStatus.OUT_OF_SCOPE.count).toBe(1);
    expect(out.unresolvable).toEqual([4]);
  });
});
