import { buildGenderReviewPreviewAttributes } from './gender-review-preview.util';

describe('buildGenderReviewPreviewAttributes', () => {
  it('deduplicates and sorts Beden sizes and keeps other attributes separate', () => {
    const result = buildGenderReviewPreviewAttributes([
      { name: 'سایز', sourceName: 'Beden', value: '۳۶', valueSource: '36', kind: 'other' },
      { name: 'سایز', sourceName: 'Beden', value: '۳۸', valueSource: '38', kind: 'other' },
      { name: 'سایز', sourceName: 'Beden', value: '۳۶', valueSource: '36', kind: 'other' },
      { name: 'سایز', sourceName: 'Beden', value: '۳۵٫۵', valueSource: '35,5', kind: 'other' },
      { name: 'رنگ', sourceName: 'Renk', value: 'سفید', valueSource: 'Beyaz', kind: 'color' },
      { name: 'رنگ', sourceName: 'Renk', value: 'سفید', valueSource: 'Beyaz', kind: 'color' },
      { name: 'جنس', sourceName: 'Materyal', value: 'چرم', valueSource: 'Deri', kind: 'other' },
      { name: 'خالی', sourceName: 'Empty', value: '  ', valueSource: '', kind: 'other' },
    ]);

    expect(result.variantSizes).toEqual(['35,5', '36', '38']);
    expect(result.sourceAttributes).toEqual([
      { name: 'رنگ', sourceName: 'Renk', values: ['Beyaz'] },
      { name: 'جنس', sourceName: 'Materyal', values: ['Deri'] },
    ]);
    expect(result.sourceAttributes.every((group) => group.sourceName !== 'Beden')).toBe(true);
  });

  it('recognizes numara size labels and falls back to Persian values', () => {
    const result = buildGenderReviewPreviewAttributes([
      {
        name: 'Ayakkabı Numarası',
        sourceName: 'Ayakkabi Numarasi',
        value: '28',
        valueSource: null,
        kind: 'other',
      },
      { name: 'برند', sourceName: null, value: 'Adidas', valueSource: null, kind: 'other' },
    ]);
    expect(result.variantSizes).toEqual(['28']);
    expect(result.sourceAttributes).toEqual([
      { name: 'برند', sourceName: null, values: ['Adidas'] },
    ]);
  });

  it('caps source attribute groups and returns empty arrays for missing input', () => {
    expect(buildGenderReviewPreviewAttributes(null)).toEqual({
      variantSizes: [],
      sourceAttributes: [],
    });
    const many = Array.from({ length: 25 }, (_, index) => ({
      name: `Attr ${index}`,
      sourceName: `Src ${index}`,
      value: `V${index}`,
      valueSource: `S${index}`,
      kind: 'other',
    }));
    expect(buildGenderReviewPreviewAttributes(many).sourceAttributes).toHaveLength(20);
  });
});
