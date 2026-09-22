import {
  findNonzeroFacetValues,
  partitionAttributeValueRowsForSelfExclusion,
  pickTopAttributesByProductCount,
} from './storefront-plp-attribute-facets';

describe('storefront-plp-attribute-facets self-exclusion helpers', () => {
  it('retains non-selected attribute value rows and lists selected for recompute', () => {
    const rows = [
      { attributeId: 12, valueId: 1, valueName: 'Red', count: 10 },
      { attributeId: 12, valueId: 2, valueName: 'Blue', count: 5 },
      { attributeId: 18, valueId: 9, valueName: 'M', count: 7 },
      { attributeId: 18, valueId: 10, valueName: 'L', count: 0 },
    ];
    const result = partitionAttributeValueRowsForSelfExclusion(rows, [12]);
    expect(result.needsSelfExclusion).toEqual([12]);
    expect(result.retained).toEqual([
      { attributeId: 18, valueId: 9, valueName: 'M', count: 7 },
    ]);
  });

  it('keeps deterministic top-N attribute discovery order', () => {
    const top = pickTopAttributesByProductCount(
      [
        { id: 3, name: 'C', type: 'other', productCount: 100 },
        { id: 1, name: 'A', type: 'other', productCount: 100 },
        { id: 2, name: 'B', type: 'other', productCount: 50 },
      ],
      2,
    );
    expect(top.map((a) => a.id)).toEqual([1, 3]);
  });

  it('flags nonzero facet values used by impossible-choice assertions', () => {
    // Fixture: Size=M selected + Color=Pink selected. Under corrected
    // self-exclusion, Size facet applies Color=Pink only. A Size value that
    // cannot combine with Pink must not appear with count > 0.
    const sizeValuesUnderColorPink = [
      { id: 101, count: 12 }, // M — possible
      { id: 102, count: 0 }, // XL — impossible with Pink in this fixture
    ];
    expect(findNonzeroFacetValues(sizeValuesUnderColorPink)).toEqual([101]);
    expect(findNonzeroFacetValues([{ id: 102, count: 0 }])).toEqual([]);
  });
});
