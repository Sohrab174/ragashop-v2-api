import {
  filterDiscountListingCandidates,
  hasValidTrendyolIdentity,
  isGenuineListingPriceGap,
} from './discount-listing-filter.util';

describe('discount listing filter', () => {
  const allowed = new Set(['Bluz', 'Elbise', 'Kazak']);

  it('accepts genuine price-gap candidates in allowed categories', () => {
    const { accepted, rejected } = filterDiscountListingCandidates(
      [
        {
          sourceId: '123',
          url: '/brand/x-p-123',
          listPrice: 100,
          salePrice: 60,
          listingDiscountPct: 40,
          categoryName: 'Bluz',
        },
      ],
      { allowedCategoryNames: allowed },
    );
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
    expect(accepted[0].listingDiscountPct).toBe(40);
  });

  it('rejects basket-only / no price gap and unsupported categories', () => {
    const { accepted, rejected } = filterDiscountListingCandidates(
      [
        {
          sourceId: '1',
          url: '/a-p-1',
          listPrice: 100,
          salePrice: 100,
          categoryName: 'Bluz',
        },
        {
          sourceId: '2',
          url: '/a-p-2',
          listPrice: 100,
          salePrice: 50,
          categoryName: 'Yüz Kremi',
        },
        {
          sourceId: '3',
          url: '/bad',
          listPrice: 100,
          salePrice: 50,
          categoryName: 'Bluz',
        },
      ],
      { allowedCategoryNames: allowed },
    );
    expect(accepted).toHaveLength(0);
    expect(rejected.map((r) => r.reason).sort()).toEqual([
      'invalid_identity_or_url',
      'not_genuine_list_sale_gap',
      'unsupported_or_ambiguous_category',
    ]);
  });

  it('dedupes by sourceId preferring higher discount', () => {
    const { accepted } = filterDiscountListingCandidates(
      [
        {
          sourceId: '9',
          url: '/x-p-9',
          listPrice: 100,
          salePrice: 80,
          categoryName: 'Bluz',
        },
        {
          sourceId: '9',
          url: '/x-p-9',
          listPrice: 100,
          salePrice: 50,
          categoryName: 'Bluz',
        },
      ],
      { allowedCategoryNames: allowed },
    );
    expect(accepted).toHaveLength(1);
    expect(accepted[0].listingDiscountPct).toBe(50);
  });

  it('helpers validate identity and genuine gap', () => {
    expect(hasValidTrendyolIdentity({ sourceId: '12', url: '/a-p-12' })).toBe(
      true,
    );
    expect(isGenuineListingPriceGap(10, 5)).toBe(true);
    expect(isGenuineListingPriceGap(10, 10)).toBe(false);
  });
});
