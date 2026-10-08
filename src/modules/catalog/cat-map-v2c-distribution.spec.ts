import {
  buildSourceCategoryPath,
  distributionFromGenderRows,
  expandSourceCategoryScopeIds,
} from './cat-map-v2c-distribution';

const taxonomy = [
  {
    id: 100,
    parentId: null,
    source: 'trendyol',
    sourceName: 'Giyim',
    name: 'لباس',
  },
  {
    id: 110,
    parentId: 100,
    source: 'trendyol',
    sourceName: 'Üst Giyim',
    name: 'بالاتنه',
  },
  {
    id: 120,
    parentId: 110,
    source: 'trendyol',
    sourceName: 'T-Shirt',
    name: 'تیشرت',
  },
  {
    id: 121,
    parentId: 120,
    source: 'trendyol',
    sourceName: 'Oversize',
    name: 'اورسایز',
  },
  {
    id: 300,
    parentId: 120,
    source: 'other',
    sourceName: 'T-Shirt',
    name: 'تیشرت',
  },
  {
    id: 400,
    parentId: null,
    source: 'other',
    sourceName: 'T-Shirt',
    name: 'تیشرت',
  },
];

describe('CAT-MAP-V2-C source path + scope', () => {
  it('builds path from sourceName (provider truth)', () => {
    expect(buildSourceCategoryPath(120, taxonomy, 'trendyol')).toEqual([
      'Giyim',
      'Üst Giyim',
      'T-Shirt',
    ]);
  });

  it('includes same-provider descendants in scope', () => {
    const ids = expandSourceCategoryScopeIds(120, 'trendyol', taxonomy);
    expect(ids).toContain(120);
    expect(ids).toContain(121);
  });

  it('excludes cross-provider children and same-name roots', () => {
    const ids = expandSourceCategoryScopeIds(120, 'trendyol', taxonomy);
    expect(ids).not.toContain(300);
    expect(ids).not.toContain(400);
  });

  it('aggregates gender rows including unknown=null', () => {
    const dist = distributionFromGenderRows([
      { gender: 'female', count: 4625 },
      { gender: 'male', count: 2661 },
      { gender: 'unisex', count: 39 },
      { gender: null, count: 404 },
    ]);
    expect(dist).toEqual({
      total: 7729,
      female: 4625,
      male: 2661,
      unisex: 39,
      unknown: 404,
    });
  });

  it('scope sum does not double-count categories', () => {
    const ids = expandSourceCategoryScopeIds(120, 'trendyol', taxonomy);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
