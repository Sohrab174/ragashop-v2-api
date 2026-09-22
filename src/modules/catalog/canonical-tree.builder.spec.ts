import {
  applyCanonicalVisibleDepth,
  buildCanonicalTree,
  prepareStorefrontNavigationTree,
  toStorefrontNavigation,
} from './canonical-tree.builder';

describe('canonical-tree.builder', () => {
  const sample = [
    { id: 1, parentId: null, name: 'زنانه', displayOrder: 2, imagePath: null },
    { id: 2, parentId: null, name: 'مردانه', displayOrder: 1, imagePath: null },
    {
      id: 10,
      parentId: 1,
      name: 'پوشاک',
      displayOrder: 1,
      imagePath: '/a.jpg',
    },
    { id: 11, parentId: 10, name: 'تیشرت', displayOrder: 1, imagePath: null },
    { id: 12, parentId: 11, name: 'نخی', displayOrder: 1, imagePath: null },
    // orphan
    { id: 99, parentId: 999, name: 'Orphan', displayOrder: 1, imagePath: null },
  ];

  it('builds deterministic ordered roots and omits orphans', () => {
    const tree = buildCanonicalTree(sample);
    expect(tree.map((n) => n.id)).toEqual([2, 1]);
    expect(tree.find((n) => n.id === 99)).toBeUndefined();
  });

  it('is cycle-safe on read (self-parent skipped)', () => {
    const withSelf = [
      { id: 1, parentId: null, name: 'A', displayOrder: 1 },
      { id: 2, parentId: 1, name: 'B', displayOrder: 1 },
      { id: 4, parentId: 4, name: 'Self', displayOrder: 1 },
    ];
    const tree = buildCanonicalTree(withSelf);
    expect(tree).toHaveLength(1);
    expect(JSON.stringify(tree)).not.toContain('"id":4');
  });

  it('caps customer-visible depth at 3', () => {
    const nav = prepareStorefrontNavigationTree(sample);
    const women = nav.find((n) => n.id === 1);
    expect(women?.children?.[0]?.id).toBe(10);
    const shirts = women?.children?.[0]?.children?.[0];
    expect(shirts?.id).toBe(11);
    expect(shirts?.hasChildren).toBe(false);
    expect(shirts?.children).toBeUndefined();
  });

  it('applyCanonicalVisibleDepth forces leaf at max depth', () => {
    const deep = buildCanonicalTree(sample);
    const capped = applyCanonicalVisibleDepth(deep, 1, 2);
    const apparel = capped.find((n) => n.id === 1)?.children?.[0];
    expect(apparel?.hasChildren).toBe(false);
  });

  it('exposes only storefront navigation fields (no source leakage)', () => {
    const nav = toStorefrontNavigation(buildCanonicalTree(sample));
    const json = JSON.stringify(nav);
    expect(json).not.toContain('source');
    expect(json).not.toContain('sourceId');
    expect(json).not.toContain('sourceName');
    expect(json).not.toContain('hierarchy');
    expect(json).not.toContain('bankType');
    expect(json).not.toContain('isLocalPrototype');
    expect(json).not.toContain('parentId');
    expect(nav[0]).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
      hasChildren: expect.any(Boolean),
    });
    expect(Object.prototype.hasOwnProperty.call(nav[0], 'image')).toBe(true);
    expect(Object.keys(nav[0]).sort()).toEqual(
      ['hasChildren', 'id', 'image', 'name'].sort(),
    );
  });

  it('returns empty array for empty catalog', () => {
    expect(prepareStorefrontNavigationTree([])).toEqual([]);
  });

  it('hides inactive rows by only receiving active inputs', () => {
    // Service filters inactive; builder only sees what is passed.
    const activeOnly = sample.filter((r) => r.id !== 2);
    const nav = prepareStorefrontNavigationTree(activeOnly);
    expect(nav.map((n) => n.id)).toEqual([1]);
  });

  it('uses imagePath as image when present', () => {
    const nav = prepareStorefrontNavigationTree(sample);
    const apparel = nav.find((n) => n.id === 1)?.children?.[0];
    expect(apparel?.image).toBe('/a.jpg');
  });
});
