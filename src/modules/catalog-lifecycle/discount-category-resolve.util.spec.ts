import {
  normalizeTrendyolSourceCategoryName,
  resolveKnownDiscountCategoryId,
} from './discount-category-resolve.util';

describe('discount category resolve', () => {
  it('maps English PDP aliases to Turkish IN_SCOPE names', () => {
    expect(normalizeTrendyolSourceCategoryName('Dresses')).toBe('Elbise');
    expect(normalizeTrendyolSourceCategoryName('Sweaters')).toBe('Kazak');
    expect(normalizeTrendyolSourceCategoryName('Trousers')).toBe('Pantolon');
    expect(normalizeTrendyolSourceCategoryName('Elbise')).toBe('Elbise');
  });

  it('resolves known Local category ids for listing names', () => {
    expect(resolveKnownDiscountCategoryId('Elbise')).toBe(15);
    expect(resolveKnownDiscountCategoryId('Dresses')).toBe(15);
    expect(resolveKnownDiscountCategoryId('Pantolon')).toBe(14);
    expect(resolveKnownDiscountCategoryId('Trousers')).toBe(14);
    expect(resolveKnownDiscountCategoryId('Kazak')).toBe(27);
    expect(resolveKnownDiscountCategoryId('Sweaters')).toBe(27);
    expect(resolveKnownDiscountCategoryId('UnknownLeaf')).toBeNull();
  });
});
