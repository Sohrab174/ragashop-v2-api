import {
  applyResolvedImages,
  collectSourceSubtreeIds,
  buildSourceChildrenMap,
  resolveCanonicalPresentationImages,
  sortSourceMappings,
} from './canonical-presentation-image';

describe('canonical-presentation-image', () => {
  const canonicals = [
    { id: 1, parentId: null, name: 'Women', displayOrder: 1, imagePath: null },
    {
      id: 2,
      parentId: 1,
      name: 'Apparel',
      displayOrder: 1,
      imagePath: null,
    },
    { id: 3, parentId: null, name: 'Beauty', displayOrder: 2, imagePath: null },
    {
      id: 4,
      parentId: null,
      name: 'Explicit',
      displayOrder: 3,
      imagePath: '/canonical/x.jpg',
    },
  ];

  it('prefers explicit canonical imagePath', () => {
    const map = resolveCanonicalPresentationImages(
      canonicals,
      [{ canonicalCategoryId: 4, sourceCategoryId: 100, source: 'trendyol' }],
      [{ id: 100, parentId: null, iconPath: '/should-not-win.jpg' }],
      [],
    );
    expect(map.get(4)).toBe('/canonical/x.jpg');
  });

  it('uses mapped source icon then product cover', () => {
    const map = resolveCanonicalPresentationImages(
      canonicals,
      [{ canonicalCategoryId: 3, sourceCategoryId: 50, source: 'trendyol' }],
      [{ id: 50, parentId: null, iconPath: '/icons/beauty.jpg' }],
      [{ categoryId: 50, pathFile: '/products/beauty-cover.jpg' }],
    );
    expect(map.get(3)).toBe('/icons/beauty.jpg');

    const coverOnly = resolveCanonicalPresentationImages(
      canonicals,
      [{ canonicalCategoryId: 3, sourceCategoryId: 50, source: 'trendyol' }],
      [{ id: 50, parentId: null, iconPath: null }],
      [{ categoryId: 50, pathFile: '/products/beauty-cover.jpg' }],
    );
    expect(coverOnly.get(3)).toBe('/products/beauty-cover.jpg');
  });

  it('uses source descendant cover when mapped root has none', () => {
    const map = resolveCanonicalPresentationImages(
      canonicals,
      [{ canonicalCategoryId: 3, sourceCategoryId: 50, source: 'trendyol' }],
      [
        { id: 50, parentId: null, iconPath: null, displayOrder: 1, name: 'A' },
        {
          id: 51,
          parentId: 50,
          iconPath: null,
          displayOrder: 1,
          name: 'Child',
        },
      ],
      [{ categoryId: 51, pathFile: '/products/child.jpg' }],
    );
    expect(map.get(3)).toBe('/products/child.jpg');
  });

  it('inherits from mapped descendant canonical without N+1 semantics', () => {
    const map = resolveCanonicalPresentationImages(
      canonicals,
      [{ canonicalCategoryId: 2, sourceCategoryId: 90, source: 'trendyol' }],
      [{ id: 90, parentId: null, iconPath: null }],
      [{ categoryId: 90, pathFile: '/products/apparel.jpg' }],
    );
    expect(map.get(2)).toBe('/products/apparel.jpg');
    expect(map.get(1)).toBe('/products/apparel.jpg');
  });

  it('returns null when nothing resolves', () => {
    const map = resolveCanonicalPresentationImages(canonicals, [], [], []);
    expect(map.get(1)).toBeNull();
    expect(map.get(3)).toBeNull();
  });

  it('collectSourceSubtreeIds is bounded and cycle-safe', () => {
    const children = buildSourceChildrenMap([
      { id: 1, parentId: null, iconPath: null, displayOrder: 1, name: 'r' },
      { id: 2, parentId: 1, iconPath: null, displayOrder: 1, name: 'a' },
      { id: 3, parentId: 2, iconPath: null, displayOrder: 1, name: 'b' },
    ]);
    expect(collectSourceSubtreeIds(1, children)).toEqual([1, 2, 3]);
  });

  it('applyResolvedImages is deterministic', () => {
    const imageById = new Map<number, string | null>([
      [1, '/a.jpg'],
      [2, null],
    ]);
    const out = applyResolvedImages(
      [
        { id: 1, parentId: null, name: 'A', displayOrder: 1 },
        { id: 2, parentId: 1, name: 'B', displayOrder: 1 },
      ],
      imageById,
    );
    expect(out[0].imagePath).toBe('/a.jpg');
    expect(out[1].imagePath).toBeNull();
  });

  it('same mapping set in different input order yields same image', () => {
    const taxonomy = [
      { id: 10, parentId: null, iconPath: null, displayOrder: 1, name: 'A' },
      {
        id: 20,
        parentId: null,
        iconPath: '/icons/b.jpg',
        displayOrder: 1,
        name: 'B',
      },
    ];
    const covers = [
      { categoryId: 10, pathFile: '/products/a.jpg' },
      { categoryId: 20, pathFile: '/products/b.jpg' },
    ];

    const orderA = [
      {
        id: 2,
        source: 'trendyol',
        canonicalCategoryId: 3,
        sourceCategoryId: 20,
      },
      {
        id: 1,
        source: 'amazon',
        canonicalCategoryId: 3,
        sourceCategoryId: 10,
      },
    ];
    const orderB = [...orderA].reverse();

    const resultA = resolveCanonicalPresentationImages(
      canonicals,
      orderA,
      taxonomy,
      covers,
    );
    const resultB = resolveCanonicalPresentationImages(
      canonicals,
      orderB,
      taxonomy,
      covers,
    );

    // amazon sorts before trendyol → sourceCategoryId 10 wins
    expect(resultA.get(3)).toBe('/products/a.jpg');
    expect(resultB.get(3)).toBe('/products/a.jpg');
    expect(resultA.get(3)).toBe(resultB.get(3));
  });

  it('same children in different input order yields same descendant image', () => {
    const covers = [
      { categoryId: 52, pathFile: '/products/second.jpg' },
      { categoryId: 51, pathFile: '/products/first.jpg' },
    ];

    const taxonomyA = [
      { id: 50, parentId: null, iconPath: null, displayOrder: 1, name: 'Root' },
      {
        id: 52,
        parentId: 50,
        iconPath: null,
        displayOrder: 2,
        name: 'Second',
      },
      {
        id: 51,
        parentId: 50,
        iconPath: null,
        displayOrder: 1,
        name: 'First',
      },
    ];
    const taxonomyB = [...taxonomyA].reverse();

    const mappings = [
      {
        id: 1,
        source: 'trendyol',
        canonicalCategoryId: 3,
        sourceCategoryId: 50,
      },
    ];

    const a = resolveCanonicalPresentationImages(
      canonicals,
      mappings,
      taxonomyA,
      covers,
    );
    const b = resolveCanonicalPresentationImages(
      canonicals,
      mappings,
      taxonomyB,
      covers,
    );

    // displayOrder 1 (id 51) wins over displayOrder 2
    expect(a.get(3)).toBe('/products/first.jpg');
    expect(b.get(3)).toBe('/products/first.jpg');
  });

  it('sortSourceMappings is stable by source then sourceCategoryId then id', () => {
    const sorted = sortSourceMappings([
      {
        id: 9,
        source: 'trendyol',
        sourceCategoryId: 2,
        canonicalCategoryId: 1,
      },
      { id: 3, source: 'amazon', sourceCategoryId: 5, canonicalCategoryId: 1 },
      { id: 1, source: 'amazon', sourceCategoryId: 4, canonicalCategoryId: 1 },
      { id: 2, source: 'amazon', sourceCategoryId: 4, canonicalCategoryId: 1 },
    ]);
    expect(sorted.map((m) => m.id)).toEqual([1, 2, 3, 9]);
  });

  it('buildSourceChildrenMap sorts siblings by displayOrder then id then name', () => {
    const map = buildSourceChildrenMap([
      { id: 3, parentId: 1, iconPath: null, displayOrder: 2, name: 'C' },
      { id: 2, parentId: 1, iconPath: null, displayOrder: 1, name: 'B' },
      { id: 4, parentId: 1, iconPath: null, displayOrder: 1, name: 'A' },
      { id: 1, parentId: null, iconPath: null, displayOrder: 1, name: 'R' },
    ]);
    expect(map.get(1)).toEqual([2, 4, 3]);
  });
});
