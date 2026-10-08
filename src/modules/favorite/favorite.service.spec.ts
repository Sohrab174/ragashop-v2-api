import { FavoriteService, mapFavoriteProductIds } from './favorite.service';

function buildQueryBuilderMock(rawRows: unknown[]) {
  const calls: Record<string, unknown[][]> = {};
  const qb: Record<string, jest.Mock> = {};
  const chain = (name: string) =>
    jest.fn((...args: unknown[]) => {
      (calls[name] ||= []).push(args);
      return qb;
    });
  for (const name of ['innerJoin', 'select', 'where', 'andWhere', 'orderBy']) {
    qb[name] = chain(name);
  }
  qb.getRawMany = jest.fn(async () => rawRows);
  return { qb, calls };
}

function buildService(rawRows: unknown[]) {
  const { qb, calls } = buildQueryBuilderMock(rawRows);
  const favoriteRepository = { createQueryBuilder: jest.fn(() => qb) };
  const service = new FavoriteService(
    favoriteRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, calls };
}

describe('FavoriteService.getProducts (GET /favorites/products/me)', () => {
  it('aliases the selected column to productId so raw rows map to ids', async () => {
    const { service, calls } = buildService([
      { productId: 97580 },
      { productId: '42' },
    ]);

    const ids = await service.getProducts({ id: 215 } as never);

    expect(ids).toEqual([97580, 42]);
    expect(calls.select).toEqual([['favorite.productId', 'productId']]);
    expect(calls.where[0]).toEqual([
      'favorite.customerId = :customerId',
      { customerId: 215 },
    ]);
    expect(calls.andWhere[0]).toEqual(['favorite.isDeleted = 0']);
  });

  it('never returns null entries for rows shaped like un-aliased TypeORM output', async () => {
    const { service } = buildService([
      { favorite_id: 1, favorite_productId: 97580 },
    ]);

    const ids = await service.getProducts({ id: 215 } as never);

    expect(ids).not.toContain(null);
    expect(ids.every((id) => Number.isInteger(id) && id > 0)).toBe(true);
  });
});

describe('mapFavoriteProductIds', () => {
  it('coerces numeric strings, drops invalid ids, and de-duplicates preserving order', () => {
    expect(
      mapFavoriteProductIds([
        { productId: '7' },
        { productId: 3 },
        { productId: null },
        { productId: undefined },
        { productId: 0 },
        { productId: -2 },
        { productId: 'abc' },
        { productId: 7 },
      ]),
    ).toEqual([7, 3]);
  });
});
