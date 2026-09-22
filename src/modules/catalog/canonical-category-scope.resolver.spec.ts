import {
  buildSameSourceChildrenMap,
  collectActiveCanonicalScopeIds,
  collectActiveMappedSourceIds,
  expandSourceCategoryIds,
  resolveCanonicalCategoryScope,
} from './canonical-category-scope.resolver';

describe('canonical-category-scope.resolver', () => {
  const canonicals = [
    { id: 1, parentId: null, status: 'active', displayOrder: 1, name: 'Women' },
    { id: 2, parentId: 1, status: 'active', displayOrder: 1, name: 'Apparel' },
    { id: 3, parentId: 1, status: 'active', displayOrder: 2, name: 'Shoes' },
    { id: 4, parentId: 1, status: 'inactive', displayOrder: 3, name: 'Bags' },
    {
      id: 5,
      parentId: 4,
      status: 'active',
      displayOrder: 1,
      name: 'Hidden child',
    },
    {
      id: 6,
      parentId: null,
      status: 'active',
      displayOrder: 2,
      name: 'Beauty',
    },
    { id: 7, parentId: null, status: 'inactive', displayOrder: 3, name: 'Off' },
  ];

  const taxonomy = [
    {
      id: 100,
      parentId: null,
      source: 'trendyol',
      status: 'active',
      displayOrder: 1,
      name: 'RootA',
    },
    {
      id: 101,
      parentId: 100,
      source: 'trendyol',
      status: 'active',
      displayOrder: 1,
      name: 'ChildA',
    },
    {
      id: 102,
      parentId: 100,
      source: 'trendyol',
      status: 'inactive',
      displayOrder: 2,
      name: 'InactiveChild',
    },
    {
      id: 200,
      parentId: null,
      source: 'beymen',
      status: 'active',
      displayOrder: 2,
      name: 'RootB',
    },
    {
      id: 201,
      parentId: 200,
      source: 'beymen',
      status: 'active',
      displayOrder: 1,
      name: 'ChildB',
    },
    {
      id: 300,
      parentId: null,
      source: 'trendyol',
      status: 'inactive',
      displayOrder: 3,
      name: 'Dead',
    },
  ];

  it('resolves a selected canonical leaf to its mapping only', () => {
    const result = resolveCanonicalCategoryScope(
      2,
      canonicals,
      [
        {
          id: 1,
          canonicalCategoryId: 2,
          sourceCategoryId: 100,
          status: 'active',
          source: 'trendyol',
        },
      ],
      taxonomy,
    );

    expect(result.canonicalCategoryIds).toEqual([2]);
    expect(result.mappedSourceCategoryIds).toEqual([100]);
    expect(result.sourceCategoryIds).toEqual([100, 101]);
  });

  it('expands active canonical descendants for a branch', () => {
    const ids = collectActiveCanonicalScopeIds(1, canonicals);
    expect(ids).toEqual([1, 2, 3]);
    expect(ids).not.toContain(4);
    expect(ids).not.toContain(5);
  });

  it('excludes inactive canonical descendants and their children', () => {
    const ids = collectActiveCanonicalScopeIds(1, canonicals);
    expect(ids.includes(4)).toBe(false);
    expect(ids.includes(5)).toBe(false);
  });

  it('uses active mappings only', () => {
    const mapped = collectActiveMappedSourceIds(
      [2, 3],
      [
        {
          id: 1,
          canonicalCategoryId: 2,
          sourceCategoryId: 100,
          status: 'active',
          source: 'trendyol',
        },
        {
          id: 2,
          canonicalCategoryId: 3,
          sourceCategoryId: 200,
          status: 'inactive',
          source: 'trendyol',
        },
        {
          id: 3,
          canonicalCategoryId: 3,
          sourceCategoryId: 200,
          status: 'draft',
          source: 'beymen',
        },
      ],
    );
    expect(mapped).toEqual([100]);
  });

  it('returns empty source set for unmapped canonical', () => {
    const result = resolveCanonicalCategoryScope(6, canonicals, [], taxonomy);
    expect(result.canonicalCategoryIds).toEqual([6]);
    expect(result.mappedSourceCategoryIds).toEqual([]);
    expect(result.sourceCategoryIds).toEqual([]);
  });

  it('returns empty when selected canonical is inactive', () => {
    const result = resolveCanonicalCategoryScope(7, canonicals, [], taxonomy);
    expect(result.canonicalCategoryIds).toEqual([]);
    expect(result.sourceCategoryIds).toEqual([]);
  });

  it('dedupes duplicate resolved source ids', () => {
    const result = resolveCanonicalCategoryScope(
      1,
      canonicals,
      [
        {
          id: 1,
          canonicalCategoryId: 2,
          sourceCategoryId: 100,
          status: 'active',
          source: 'trendyol',
        },
        {
          id: 2,
          canonicalCategoryId: 3,
          sourceCategoryId: 100,
          status: 'active',
          source: 'trendyol',
        },
        {
          id: 3,
          canonicalCategoryId: 1,
          sourceCategoryId: 200,
          status: 'active',
          source: 'beymen',
        },
      ],
      taxonomy,
    );

    expect(result.mappedSourceCategoryIds).toEqual([100, 200]);
    expect(result.sourceCategoryIds).toEqual([100, 101, 200, 201]);
  });

  it('expands source descendants and skips inactive source children', () => {
    const expanded = expandSourceCategoryIds(
      [{ sourceCategoryId: 100, source: 'trendyol' }],
      taxonomy,
    );
    expect(expanded).toEqual([100, 101]);
    expect(expanded).not.toContain(102);
  });

  it('skips inactive mapped source roots', () => {
    const expanded = expandSourceCategoryIds(
      [{ sourceCategoryId: 300, source: 'trendyol' }],
      taxonomy,
    );
    expect(expanded).toEqual([]);
  });

  it('includes same-source deep descendants', () => {
    const deepTaxonomy = [
      ...taxonomy,
      {
        id: 110,
        parentId: 101,
        source: 'trendyol',
        status: 'active',
        displayOrder: 1,
        name: 'DeepA',
      },
    ];
    const expanded = expandSourceCategoryIds(
      [{ sourceCategoryId: 100, source: 'trendyol' }],
      deepTaxonomy,
    );
    expect(expanded).toEqual([100, 101, 110]);
  });

  it('excludes cross-source child with matching parentId (Codex scenario)', () => {
    // Malformed/cross-source: Beymen/Amazon child points at Trendyol parent.
    const leaky = [
      ...taxonomy,
      {
        id: 901,
        parentId: 100,
        source: 'beymen',
        status: 'active',
        displayOrder: 5,
        name: 'Cross Beymen',
      },
      {
        id: 902,
        parentId: 100,
        source: 'amazon',
        status: 'active',
        displayOrder: 6,
        name: 'Cross Amazon',
      },
      {
        id: 903,
        parentId: 901,
        source: 'beymen',
        status: 'active',
        displayOrder: 1,
        name: 'Cross grandchild',
      },
    ];

    const expanded = expandSourceCategoryIds(
      [{ sourceCategoryId: 100, source: 'trendyol' }],
      leaky,
    );

    expect(expanded).toEqual([100, 101]);
    expect(expanded).not.toContain(901);
    expect(expanded).not.toContain(902);
    expect(expanded).not.toContain(903);
  });

  it('excludes source-null children (explicit null-source policy)', () => {
    const withNull = [
      ...taxonomy,
      {
        id: 150,
        parentId: 100,
        source: null,
        status: 'active',
        displayOrder: 3,
        name: 'Null source child',
      },
      {
        id: 151,
        parentId: 100,
        source: '',
        status: 'active',
        displayOrder: 4,
        name: 'Empty source child',
      },
    ];

    const expanded = expandSourceCategoryIds(
      [{ sourceCategoryId: 100, source: 'trendyol' }],
      withNull,
    );
    expect(expanded).toEqual([100, 101]);
    expect(expanded).not.toContain(150);
    expect(expanded).not.toContain(151);
  });

  it('does not expand when mapping.source is null (root only)', () => {
    const expanded = expandSourceCategoryIds(
      [{ sourceCategoryId: 100, source: null }],
      taxonomy,
    );
    expect(expanded).toEqual([100]);
    expect(expanded).not.toContain(101);
  });

  it('keeps multi-retailer mappings isolated while combining scopes', () => {
    const result = resolveCanonicalCategoryScope(
      1,
      canonicals,
      [
        {
          id: 1,
          canonicalCategoryId: 2,
          sourceCategoryId: 100,
          status: 'active',
          source: 'trendyol',
        },
        {
          id: 2,
          canonicalCategoryId: 3,
          sourceCategoryId: 200,
          status: 'active',
          source: 'beymen',
        },
      ],
      [
        ...taxonomy,
        {
          id: 180,
          parentId: 100,
          source: 'beymen',
          status: 'active',
          displayOrder: 9,
          name: 'Should not leak into trendyol',
        },
        {
          id: 280,
          parentId: 200,
          source: 'trendyol',
          status: 'active',
          displayOrder: 9,
          name: 'Should not leak into beymen',
        },
      ],
    );

    expect(result.sourceCategoryIds).toEqual([100, 101, 200, 201]);
    expect(result.sourceCategoryIds).not.toContain(180);
    expect(result.sourceCategoryIds).not.toContain(280);
  });

  it('buildSameSourceChildrenMap never returns other sources', () => {
    const map = buildSameSourceChildrenMap(
      [
        ...taxonomy,
        {
          id: 901,
          parentId: 100,
          source: 'amazon',
          status: 'active',
          displayOrder: 1,
          name: 'Leak',
        },
      ],
      'trendyol',
    );
    expect(map.get(100)).toEqual([101]);
  });

  it('is cycle-safe and depth-bounded for canonical traversal', () => {
    const cycleRows = [
      { id: 10, parentId: 11, status: 'active', displayOrder: 1, name: 'A' },
      { id: 11, parentId: 10, status: 'active', displayOrder: 1, name: 'B' },
    ];
    const ids = collectActiveCanonicalScopeIds(10, cycleRows);
    expect(ids.length).toBeLessThanOrEqual(2);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('respects max depth for canonical descendants', () => {
    const deep = [
      { id: 1, parentId: null, status: 'active', displayOrder: 1, name: 'L0' },
      { id: 2, parentId: 1, status: 'active', displayOrder: 1, name: 'L1' },
      { id: 3, parentId: 2, status: 'active', displayOrder: 1, name: 'L2' },
      { id: 4, parentId: 3, status: 'active', displayOrder: 1, name: 'L3' },
    ];
    const ids = collectActiveCanonicalScopeIds(1, deep, { maxDepth: 1 });
    expect(ids).toEqual([1, 2]);
  });

  it('respects source subtree node bound', () => {
    const chain = [
      {
        id: 100,
        parentId: null,
        source: 'trendyol',
        status: 'active',
        displayOrder: 1,
        name: 'R',
      },
      {
        id: 101,
        parentId: 100,
        source: 'trendyol',
        status: 'active',
        displayOrder: 1,
        name: 'A',
      },
      {
        id: 102,
        parentId: 101,
        source: 'trendyol',
        status: 'active',
        displayOrder: 1,
        name: 'B',
      },
      {
        id: 103,
        parentId: 102,
        source: 'trendyol',
        status: 'active',
        displayOrder: 1,
        name: 'C',
      },
    ];
    const expanded = expandSourceCategoryIds(
      [{ sourceCategoryId: 100, source: 'trendyol' }],
      chain,
      { maxNodesPerRoot: 2 },
    );
    expect(expanded.length).toBe(2);
    expect(expanded).toEqual([100, 101]);
  });

  it('is deterministic regardless of input order', () => {
    const mappings = [
      {
        id: 2,
        canonicalCategoryId: 3,
        sourceCategoryId: 200,
        status: 'active',
        source: 'beymen',
      },
      {
        id: 1,
        canonicalCategoryId: 2,
        sourceCategoryId: 100,
        status: 'active',
        source: 'trendyol',
      },
    ];
    const a = resolveCanonicalCategoryScope(
      1,
      [...canonicals].reverse(),
      [...mappings].reverse(),
      [...taxonomy].reverse(),
    );
    const b = resolveCanonicalCategoryScope(1, canonicals, mappings, taxonomy);
    expect(a).toEqual(b);
  });

  it('does not use name or gender heuristics — only explicit mappings', () => {
    const result = resolveCanonicalCategoryScope(
      1,
      [
        ...canonicals,
        {
          id: 99,
          parentId: 1,
          status: 'active',
          displayOrder: 9,
          name: 'مردانه',
        },
      ],
      [
        {
          id: 1,
          canonicalCategoryId: 2,
          sourceCategoryId: 100,
          status: 'active',
          source: 'trendyol',
        },
      ],
      [
        ...taxonomy,
        {
          id: 999,
          parentId: null,
          source: 'trendyol',
          status: 'active',
          displayOrder: 9,
          name: 'لباس مردانه',
        },
      ],
    );

    expect(result.sourceCategoryIds).toEqual([100, 101]);
    expect(result.sourceCategoryIds).not.toContain(999);
  });
});
