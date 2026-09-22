import {
  applyCustomerVisibleDepth,
  attachPresentationImages,
  buildCategoryTree,
  collapsePassthroughNodes,
  collectCategoryIds,
  inheritImagesFromDescendants,
  prepareCustomerCatalogTree,
} from './category-tree.builder';
import {
  fillImagesFromDescendantCovers,
  resolveDirectPresentationImages,
} from './category-presentation-image';

describe('category-tree.builder', () => {
  const sample = [
    { id: 10, parentId: null, name: 'Women', displayOrder: 2 },
    { id: 11, parentId: null, name: 'Men', displayOrder: 1 },
    { id: 20, parentId: 10, name: 'Clothing', displayOrder: 1 },
    { id: 21, parentId: 20, name: 'Shirts', displayOrder: 1 },
    { id: 22, parentId: 21, name: 'Dress shirts', displayOrder: 1 },
    { id: 23, parentId: 22, name: 'Oxford', displayOrder: 1 },
    // orphan: missing parent
    { id: 99, parentId: 999, name: 'Orphan', displayOrder: 1 },
    // active child of inactive/missing parent behaves as orphan
    { id: 98, parentId: 777, name: 'InactiveParentChild', displayOrder: 1 },
  ];

  it('builds ordered roots and omits orphans', () => {
    const tree = buildCategoryTree(sample as any);
    expect(tree.map((n) => n.id)).toEqual([11, 10]);
    expect(tree.find((n) => n.id === 99)).toBeUndefined();
    expect(tree.find((n) => n.id === 98)).toBeUndefined();
  });

  it('is cycle-safe on read', () => {
    const cyclic = [
      { id: 1, parentId: null, name: 'A', displayOrder: 1 },
      { id: 2, parentId: 1, name: 'B', displayOrder: 1 },
      { id: 3, parentId: 2, name: 'C', displayOrder: 1 },
    ];
    // Simulate corrupted adjacency where 2 also claims parent 3 via duplicate walk:
    // buildCategoryTree uses parentId match + ancestor set; inject a fake child loop
    // by making id 2 appear under both 1 and under itself via parentId=2 wrongly —
    // self-parent is skipped by ancestor set when descending.
    const withSelf = [
      ...cyclic,
      { id: 4, parentId: 4, name: 'Self', displayOrder: 1 },
    ];
    const tree = buildCategoryTree(withSelf as any);
    expect(tree).toHaveLength(1);
    expect(JSON.stringify(tree)).not.toContain('"id":4');
  });

  it('caps customer-visible depth at 3', () => {
    const tree = prepareCustomerCatalogTree(sample as any);
    const women = tree.find((n) => n.id === 10);
    expect(women?.subCategories?.[0]?.id).toBe(20);
    const shirts = women?.subCategories?.[0]?.subCategories?.[0];
    expect(shirts?.id).toBe(21);
    // Level 3 is a leaf for customers even if backend has deeper nodes
    expect(shirts?.hasChildren).toBe(false);
    expect(shirts?.subCategories).toBeUndefined();
  });

  it('applyCustomerVisibleDepth forces leaf at max depth', () => {
    const deep = buildCategoryTree(sample as any);
    const capped = applyCustomerVisibleDepth(deep, 1, 2);
    const clothing = capped.find((n) => n.id === 10)?.subCategories?.[0];
    expect(clothing?.hasChildren).toBe(false);
  });

  it('collapsePassthrough promotes single-child tunnels', () => {
    const nodes = [
      {
        id: 1,
        parentId: null,
        name: 'Root',
        displayOrder: 1,
        subCategories: [
          {
            id: 2,
            parentId: 1,
            name: 'Only',
            displayOrder: 1,
            subCategories: [
              { id: 3, parentId: 2, name: 'LeafA', displayOrder: 1 },
              { id: 4, parentId: 2, name: 'LeafB', displayOrder: 2 },
            ],
          },
        ],
      },
    ];
    const collapsed = collapsePassthroughNodes(nodes as any);
    expect(collapsed[0].id).toBe(2);
    expect(collapsed[0].subCategories?.map((c) => c.id)).toEqual([3, 4]);
  });

  it('collectCategoryIds walks the tree', () => {
    const tree = buildCategoryTree(
      sample.filter((c) => ![99, 98].includes(c.id)) as any,
    );
    const ids = collectCategoryIds(tree);
    expect(ids).toEqual(expect.arrayContaining([10, 11, 20, 21, 22, 23]));
  });

  it('does not depend on literal لباس or virtual gender ids', () => {
    const tree = prepareCustomerCatalogTree([
      { id: 5, parentId: null, name: 'لباس', displayOrder: 1 },
      { id: 6, parentId: 5, name: 'Tops', displayOrder: 1 },
    ] as any);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe(5);
    expect(typeof tree[0].id).toBe('number');
    expect(tree.find((n) => n.id === ('female' as any))).toBeUndefined();
  });
});

describe('category-presentation-image', () => {
  it('prefers iconPath then product cover', () => {
    const categories = [
      { id: 1, iconPath: '/categories/a.jpg' },
      { id: 2, iconPath: null },
      { id: 3, iconPath: null },
    ];
    const covers = [
      { categoryId: 2, pathFile: '/products/b.jpg' },
      { categoryId: 3, pathFile: '/products/c.jpg' },
    ];
    const map = resolveDirectPresentationImages(categories, covers);
    expect(map.get(1)).toBe('/categories/a.jpg');
    expect(map.get(2)).toBe('/products/b.jpg');
    expect(map.get(3)).toBe('/products/c.jpg');
  });

  it('fills from descendant covers', () => {
    const categories = [
      { id: 1, parentId: null, iconPath: null },
      { id: 2, parentId: 1, iconPath: null },
      { id: 3, parentId: 2, iconPath: null },
    ];
    const direct = resolveDirectPresentationImages(categories, []);
    const filled = fillImagesFromDescendantCovers(categories, direct, [
      { categoryId: 3, pathFile: '/products/leaf.jpg' },
    ]);
    expect(filled.get(1)).toBe('/products/leaf.jpg');
    expect(filled.get(2)).toBe('/products/leaf.jpg');
    expect(filled.get(3)).toBe('/products/leaf.jpg');
  });

  it('attach + inherit helpers keep fallback chain', () => {
    const tree = buildCategoryTree([
      { id: 1, parentId: null, name: 'A', displayOrder: 1, iconPath: null },
      {
        id: 2,
        parentId: 1,
        name: 'B',
        displayOrder: 1,
        iconPath: null,
        presentationImage: '/products/x.jpg',
      },
    ] as any);
    const inherited = inheritImagesFromDescendants(tree);
    expect(inherited[0].presentationImage).toBe('/products/x.jpg');
    const attached = attachPresentationImages(
      tree,
      new Map([[2, '/products/y.jpg']]),
    );
    expect(attached[0].subCategories?.[0].presentationImage).toBe(
      '/products/y.jpg',
    );
  });
});
