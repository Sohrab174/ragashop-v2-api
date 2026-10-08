import { buildCategoryTree } from './category-tree.builder';

describe('ADMIN-V2 category tree helpers', () => {
  it('builds hierarchy with inactive nodes included in input', () => {
    const flat = [
      {
        id: 10,
        parentId: null,
        name: 'زنانه',
        status: 'active',
        displayOrder: 1,
        productCount: 2,
      },
      {
        id: 11,
        parentId: 10,
        name: 'لباس',
        status: 'inactive',
        displayOrder: 1,
        productCount: 0,
      },
      {
        id: 12,
        parentId: 11,
        name: 'پیراهن',
        status: 'active',
        displayOrder: 1,
        productCount: 5,
      },
    ];

    const tree = buildCategoryTree(flat as any);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('زنانه');
    expect(tree[0].subCategories?.[0].name).toBe('لباس');
    expect(tree[0].subCategories?.[0].status).toBe('inactive');
    expect(tree[0].subCategories?.[0].subCategories?.[0].name).toBe('پیراهن');
  });

  it('detects orphans when parent is missing', () => {
    const flat = [
      {
        id: 20,
        parentId: null,
        name: 'ریشه',
        displayOrder: 1,
      },
      {
        id: 21,
        parentId: 999,
        name: 'یتیم',
        displayOrder: 1,
      },
    ];
    const idSet = new Set(flat.map((c) => c.id));
    const orphans = flat.filter(
      (c) => c.parentId != null && !idSet.has(Number(c.parentId)),
    );
    const tree = buildCategoryTree(flat as any);

    expect(tree).toHaveLength(1);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].name).toBe('یتیم');
  });
});
