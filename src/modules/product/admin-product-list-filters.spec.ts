import { ProductService } from './product.service';

/**
 * Narrow unit coverage for ADMIN-V2 product list filter extras.
 * RBAC remains on the controller via product.read.
 */
describe('ProductService.getAllForAdmin filter extras', () => {
  let service: ProductService;
  let andWhereCalls: any[];
  let builder: any;

  beforeEach(() => {
    andWhereCalls = [];
    builder = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn((...args) => {
        andWhereCalls.push(args);
        return builder;
      }),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    const productRepository: any = {
      createQueryBuilder: jest.fn(() => builder),
    };

    service = new ProductService(
      productRepository,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { withProductChildLock: jest.fn((_id, fn) => fn()) } as any,
    );
  });

  it('applies unified search across name/sourceName/number', async () => {
    await service.getAllForAdmin(1, 20, null, null, null, null, {
      search: 'کتانی',
    });

    const searchCall = andWhereCalls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('product.name LIKE :search'),
    );
    expect(searchCall).toBeTruthy();
    expect(searchCall[1]).toEqual({ search: '%کتانی%' });
  });

  it('filters in_stock and out_of_stock by quantity', async () => {
    await service.getAllForAdmin(1, 20, null, null, null, null, {
      stock: 'in_stock',
    });
    expect(
      andWhereCalls.some((c) => c[0] === 'product.quantity <> 0'),
    ).toBe(true);

    andWhereCalls.length = 0;
    await service.getAllForAdmin(1, 20, null, null, null, null, {
      stock: 'out_of_stock',
    });
    expect(
      andWhereCalls.some((c) => c[0] === 'product.quantity = 0'),
    ).toBe(true);
  });

  it('filters discounted products via discountPercent', async () => {
    await service.getAllForAdmin(1, 20, null, null, null, null, {
      discounted: '1',
    });
    expect(
      andWhereCalls.some(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('product.discountPercent > 0'),
      ),
    ).toBe(true);
  });

  it('applies min/max price bounds', async () => {
    await service.getAllForAdmin(1, 20, null, null, null, null, {
      minPrice: 100,
      maxPrice: 500,
    });
    expect(
      andWhereCalls.some(
        (c) => c[0] === 'product.price >= :minPrice' && c[1].minPrice === 100,
      ),
    ).toBe(true);
    expect(
      andWhereCalls.some(
        (c) => c[0] === 'product.price <= :maxPrice' && c[1].maxPrice === 500,
      ),
    ).toBe(true);
  });
});
