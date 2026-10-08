import { AssortmentAutoMapService } from './assortment-auto-map.service';

describe('AssortmentAutoMapService.evaluate (AUTO-MAP gated by assortment)', () => {
  const service = new AssortmentAutoMapService({} as any);

  const categories = [
    { id: 10, parentId: null, source: 'trendyol', sourceName: 'Elbise', name: 'Elbise', hierarchy: 'Giyim/Elbise', bankTypeName: null, gender: null, status: 'active' },
    { id: 20, parentId: null, source: 'trendyol', sourceName: 'Halı', name: 'Halı', hierarchy: 'Ev & Mobilya/Ev Tekstili/Halı', bankTypeName: null, gender: null, status: 'active' },
    { id: 30, parentId: null, source: 'trendyol', sourceName: 'Koltuk', name: 'Koltuk', hierarchy: 'Ev & Mobilya/Mobilya/Koltuk', bankTypeName: null, gender: null, status: 'active' },
  ];
  const products = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: 100 + i, categoryId: 10, gender: 'female', ageGroup: 'adult', sourceName: 'Kadın Elbise' })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: 200 + i, categoryId: 20, gender: null, ageGroup: null, sourceName: 'Halı' })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: 300 + i, categoryId: 30, gender: null, ageGroup: null, sourceName: 'Koltuk' })),
  ];
  const resolutions = [
    { categoryId: 10, status: 'IN_SCOPE' },
    { categoryId: 20, status: 'REVIEW_REQUIRED' },
    { categoryId: 30, status: 'OUT_OF_SCOPE' },
  ];

  const out = service.evaluate({
    policyVersion: 2,
    canonicals: [],
    categories,
    products,
    resolutions,
  });

  it('only IN_SCOPE nodes receive an AUTO-MAP tier', () => {
    const byId = new Map(out.nodes.map((n) => [n.sourceCategoryId, n]));
    expect(byId.get(10)?.tier).not.toBeNull();
    expect(byId.get(20)?.tier).toBeNull();
    expect(byId.get(20)?.gate).toBe('ASSORTMENT_QUEUE');
    expect(byId.get(30)?.tier).toBeNull();
    expect(byId.get(30)?.gate).toBe('STOP_OUT_OF_SCOPE');
  });

  it('coverage denominator counts IN products only; REVIEW/OUT are informational', () => {
    expect(out.coverage.products.inScopeDiscoverable).toBe(5);
    expect(out.coverage.products.reviewDiscoverable).toBe(4);
    expect(out.coverage.products.outDiscoverable).toBe(3);
    expect(out.coverage.products.totalDiscoverable).toBe(12);
  });

  it('missing destination is counted within IN only (empty canonical tree)', () => {
    const tierTotal = Object.values(out.inScopeByTier).reduce(
      (s, t) => s + t.categories,
      0,
    );
    expect(tierTotal).toBe(1);
    expect(out.coverage.categories.inScopeMissingDestination).toBeLessThanOrEqual(1);
    expect(out.coverage.products.inScopeMissingDestinationProducts).toBeLessThanOrEqual(5);
  });
});
