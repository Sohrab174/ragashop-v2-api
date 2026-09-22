import {
  applyStorefrontDiscountDiscoveryFilter,
  applyStorefrontPlpSort,
  parseStorefrontPlpQuery,
  STOREFRONT_EFFECTIVE_PRICE_SQL,
  STOREFRONT_PLP_MAX_LIMIT,
  STOREFRONT_VISIBLE_DISCOUNT_SQL,
} from './storefront-plp.query';
import {
  buildStorefrontPlpPagination,
  mapStorefrontPlpProduct,
} from './storefront-plp.mapper';
import {
  effectiveSellPrice,
  isRealSale,
  visibleDiscountPercent,
} from './storefront-plp.pricing';

describe('storefront-plp.query', () => {
  it('parses valid query with defaults', () => {
    const parsed = parseStorefrontPlpQuery({ categoryId: '12' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual({
      categoryId: 12,
      page: 1,
      limit: 24,
      sort: 'default',
      filters: {
        brandIds: [],
        minPrice: null,
        maxPrice: null,
        attributes: [],
      },
    });
  });

  it('rejects invalid canonical category id', () => {
    expect(parseStorefrontPlpQuery({}).ok).toBe(false);
    expect(parseStorefrontPlpQuery({ categoryId: '0' }).ok).toBe(false);
    expect(parseStorefrontPlpQuery({ categoryId: '-1' }).ok).toBe(false);
    expect(parseStorefrontPlpQuery({ categoryId: 'abc' }).ok).toBe(false);
  });

  it('validates page and limit bounds', () => {
    expect(parseStorefrontPlpQuery({ categoryId: 1, page: 0 }).ok).toBe(false);
    expect(parseStorefrontPlpQuery({ categoryId: 1, page: 1.5 }).ok).toBe(
      false,
    );
    expect(
      parseStorefrontPlpQuery({
        categoryId: 1,
        limit: STOREFRONT_PLP_MAX_LIMIT + 1,
      }).ok,
    ).toBe(false);
    expect(parseStorefrontPlpQuery({ categoryId: 1, limit: 0 }).ok).toBe(false);
  });

  it('rejects unsupported sort keys (no fake popular)', () => {
    expect(parseStorefrontPlpQuery({ categoryId: 1, sort: 'popular' }).ok).toBe(
      false,
    );
    expect(parseStorefrontPlpQuery({ categoryId: 1, sort: 'sales' }).ok).toBe(
      false,
    );
    expect(
      parseStorefrontPlpQuery({ categoryId: 1, sort: 'price_asc' }).ok,
    ).toBe(true);
  });

  it('applies deterministic sort keys', () => {
    const calls: Array<[string, string?]> = [];
    const builder = {
      orderBy: (field: string, dir?: 'ASC' | 'DESC') => {
        calls.push([field, dir]);
        return builder;
      },
      addOrderBy: (field: string, dir?: 'ASC' | 'DESC') => {
        calls.push([field, dir]);
        return builder;
      },
    };

    applyStorefrontPlpSort(builder, 'price_asc');
    expect(calls[0]).toEqual(['mainPrice', 'ASC']);
    expect(calls[1]).toEqual(['product.id', 'ASC']);

    calls.length = 0;
    applyStorefrontPlpSort(builder, 'discount');
    expect(calls[0]).toEqual(['visibleDiscount', 'DESC']);
    expect(calls[1]).toEqual(['product.id', 'ASC']);

    calls.length = 0;
    applyStorefrontPlpSort(builder, 'default');
    expect(calls).toEqual([['product.id', 'DESC']]);
  });

  it('uses real-sale SQL for price and discount sorts', () => {
    expect(STOREFRONT_EFFECTIVE_PRICE_SQL).toContain(
      'discountedPrice < product.price',
    );
    expect(STOREFRONT_VISIBLE_DISCOUNT_SQL).toContain(
      'discountedPrice < product.price',
    );
    expect(STOREFRONT_VISIBLE_DISCOUNT_SQL).not.toContain('discountPercent');
  });

  it('applies real-sale WHERE for discount discovery filter', () => {
    const andWhere = jest.fn();
    applyStorefrontDiscountDiscoveryFilter({ andWhere });
    expect(andWhere).toHaveBeenCalledWith(
      expect.stringContaining('discountedPrice < product.price'),
    );
  });
});

describe('storefront-plp real-sale predicate', () => {
  it('treats discountedPrice < price as real sale', () => {
    expect(isRealSale(100, 80)).toBe(true);
    expect(effectiveSellPrice(100, 80)).toBe(80);
    expect(visibleDiscountPercent(100, 80)).toBe(20);
  });

  it('treats discountedPrice == price as NOT a sale', () => {
    expect(isRealSale(100, 100)).toBe(false);
    expect(effectiveSellPrice(100, 100)).toBe(100);
    expect(visibleDiscountPercent(100, 100)).toBeNull();
  });

  it('treats discountedPrice > price as NOT a sale', () => {
    expect(isRealSale(100, 120)).toBe(false);
    expect(effectiveSellPrice(100, 120)).toBe(100);
    expect(visibleDiscountPercent(100, 120)).toBeNull();
  });

  it('treats discountedPrice = 0 as NOT a sale', () => {
    expect(isRealSale(100, 0)).toBe(false);
    expect(effectiveSellPrice(100, 0)).toBe(100);
  });

  it('treats discountedPrice = null as NOT a sale', () => {
    expect(isRealSale(100, null)).toBe(false);
    expect(effectiveSellPrice(100, null)).toBe(100);
    expect(visibleDiscountPercent(100, null)).toBeNull();
  });

  it('ignores positive discountPercent when discountedPrice == price', () => {
    const mapped = mapStorefrontPlpProduct(
      {
        id: 1,
        name: 'Equal',
        price: 200,
        discountedPrice: 200,
        discountPercent: 15,
      },
      1,
    );
    expect(mapped.price).toBe(200);
    expect(mapped.compareAtPrice).toBeNull();
    expect(mapped.discount).toBeNull();
    expect(visibleDiscountPercent(200, 200)).toBeNull();
  });

  it('ignores positive discountPercent when discountedPrice > price', () => {
    const mapped = mapStorefrontPlpProduct(
      {
        id: 2,
        name: 'Greater',
        price: 200,
        discountedPrice: 250,
        discountPercent: 10,
      },
      1,
    );
    expect(mapped.price).toBe(200);
    expect(mapped.compareAtPrice).toBeNull();
    expect(mapped.discount).toBeNull();
  });

  it('price_asc/desc effective price matches mapper current price', () => {
    const cases = [
      { price: 100, discountedPrice: 80 },
      { price: 100, discountedPrice: 100 },
      { price: 100, discountedPrice: 120 },
      { price: 100, discountedPrice: 0 },
      { price: 100, discountedPrice: null },
    ];
    for (const row of cases) {
      const effective = effectiveSellPrice(row.price, row.discountedPrice);
      const mapped = mapStorefrontPlpProduct(
        {
          id: 9,
          name: 'P',
          price: row.price,
          discountedPrice: row.discountedPrice,
          discountPercent: 50,
        },
        1,
      );
      expect(mapped.price).toBe(Math.round(effective));
    }
  });

  it('discount sort value is 0 for non-sales (deterministic tie-break via id)', () => {
    expect(visibleDiscountPercent(50, 50)).toBeNull();
    expect(visibleDiscountPercent(50, 60)).toBeNull();
    expect(visibleDiscountPercent(50, 40)).toBe(20);
    // Tie-break contract: applyStorefrontPlpSort adds product.id ASC after visibleDiscount.
    const calls: Array<[string, string?]> = [];
    const builder = {
      orderBy: (field: string, dir?: 'ASC' | 'DESC') => {
        calls.push([field, dir]);
        return builder;
      },
      addOrderBy: (field: string, dir?: 'ASC' | 'DESC') => {
        calls.push([field, dir]);
        return builder;
      },
    };
    applyStorefrontPlpSort(builder, 'discount');
    expect(calls).toEqual([
      ['visibleDiscount', 'DESC'],
      ['product.id', 'ASC'],
    ]);
  });
});

describe('storefront-plp.mapper', () => {
  it('maps pricing with real compare-at only when discounted', () => {
    const item = mapStorefrontPlpProduct(
      {
        id: 5,
        name: 'Shoe',
        price: 100,
        discountedPrice: 80,
        discountPercent: 20,
        cover: { pathFile: '/p/a.jpg' },
        brand: { name: 'Brand', sourceName: 'SRC' },
      },
      10,
    );

    expect(item).toEqual({
      id: 5,
      name: 'Shoe',
      image: '/p/a.jpg',
      brand: 'Brand',
      price: 800,
      compareAtPrice: 1000,
      discount: 20,
      available: true, // unknown/missing sourceAvailability → not sold-out
    });
  });

  it('maps available from normalized sourceAvailability', () => {
    expect(
      mapStorefrontPlpProduct(
        {
          id: 1,
          name: 'A',
          price: 10,
          discountedPrice: null,
          discountPercent: null,
          sourceAvailability: 'available',
        },
        1,
      ).available,
    ).toBe(true);
    expect(
      mapStorefrontPlpProduct(
        {
          id: 2,
          name: 'U',
          price: 10,
          discountedPrice: null,
          discountPercent: null,
          sourceAvailability: 'unknown',
        },
        1,
      ).available,
    ).toBe(true);
    expect(
      mapStorefrontPlpProduct(
        {
          id: 3,
          name: 'X',
          price: 10,
          discountedPrice: null,
          discountPercent: null,
          sourceAvailability: 'unavailable',
        },
        1,
      ).available,
    ).toBe(false);
  });

  it('omits compareAtPrice when no real sale', () => {
    const item = mapStorefrontPlpProduct(
      {
        id: 1,
        name: 'X',
        price: 50,
        discountedPrice: 0,
        discountPercent: 0,
        cover: null,
        brand: { name: null, sourceName: 'SrcBrand' },
      },
      2,
    );

    expect(item.price).toBe(100);
    expect(item.compareAtPrice).toBeNull();
    expect(item.discount).toBeNull();
    expect(item.brand).toBe('SrcBrand');
    expect(item.image).toBeNull();
  });

  it('builds empty pagination for zero total', () => {
    expect(buildStorefrontPlpPagination(1, 24, 0)).toEqual({
      page: 1,
      limit: 24,
      total: 0,
      totalPages: 0,
    });
  });

  it('builds pagination pages', () => {
    expect(buildStorefrontPlpPagination(2, 24, 50)).toEqual({
      page: 2,
      limit: 24,
      total: 50,
      totalPages: 3,
    });
  });
});
