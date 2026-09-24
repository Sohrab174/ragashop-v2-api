import { StorefrontHomeService } from './storefront-home.service';
import { STOREFRONT_HOME_SECTION_KEYS } from './storefront-home.types';

function makeRow(partial: Record<string, unknown>) {
  return {
    id: 1,
    enabled: true,
    displayOrder: 10,
    title: null,
    subtitle: null,
    configJson: '{}',
    startAt: null,
    endAt: null,
    createdAt: new Date(),
    updatedAt: null,
    ...partial,
  };
}

describe('StorefrontHomeService public contract', () => {
  const error = {
    unprocessableEntity: jest.fn((msgs) => {
      throw new Error(msgs.join(','));
    }),
  };
  const config = { app: { apiBaseUrl: 'http://127.0.0.1:9010' } };

  function buildService(rows: any[], productIds: number[] = [], categoryIds: number[] = []) {
    const sectionRepo = {
      find: jest.fn().mockResolvedValue(rows),
      findOne: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => v),
    };
    const productRepo = {
      createQueryBuilder: jest.fn(() => {
        const qb: any = {
          select: () => qb,
          where: () => qb,
          andWhere: () => qb,
          getMany: async () => productIds.map((id) => ({ id })),
        };
        return qb;
      }),
    };
    const categoryRepo = {
      find: jest.fn().mockResolvedValue(categoryIds.map((id) => ({ id }))),
    };
    const canonicalCategoryRepo = {
      find: jest.fn().mockResolvedValue(categoryIds.map((id) => ({ id }))),
    };

    return new StorefrontHomeService(
      sectionRepo as any,
      productRepo as any,
      categoryRepo as any,
      canonicalCategoryRepo as any,
      error as any,
      config as any,
    );
  }

  it('exposes only whitelisted section keys and strips unknown keys', async () => {
    const service = buildService([
      makeRow({ sectionKey: 'campaign', title: 'Hero', displayOrder: 10 }),
      makeRow({ sectionKey: 'not_a_real_key', displayOrder: 1 }),
      makeRow({
        sectionKey: 'paste_link',
        enabled: true,
        displayOrder: 50,
        title: 'لینک بده',
      }),
    ]);

    const result = await service.getPublicHome();
    expect(result.sections.map((s) => s.key)).toEqual([
      'campaign',
      'paste_link',
    ]);
    expect(result.sections[0].hero?.title).toBe('Hero');
  });

  it('disables sections outside schedule and keeps order', async () => {
    const now = new Date('2026-06-15T12:00:00Z');
    const service = buildService([
      makeRow({
        sectionKey: 'newest',
        displayOrder: 30,
        enabled: true,
        title: 'جدید',
      }),
      makeRow({
        sectionKey: 'discounts',
        displayOrder: 20,
        enabled: true,
        title: 'تخفیف',
        startAt: new Date('2026-07-01T00:00:00Z'),
      }),
      makeRow({
        sectionKey: 'categories',
        displayOrder: 10,
        enabled: false,
        title: 'دسته',
      }),
    ]);

    const result = await service.getPublicHome(now);
    expect(result.sections.map((s) => s.key)).toEqual([
      'categories',
      'discounts',
      'newest',
    ]);
    expect(result.sections.find((s) => s.key === 'categories')?.enabled).toBe(
      false,
    );
    expect(result.sections.find((s) => s.key === 'discounts')?.enabled).toBe(
      false,
    );
    expect(result.sections.find((s) => s.key === 'newest')?.enabled).toBe(true);
  });

  it('filters inactive curated product ids and falls back rail source', async () => {
    const service = buildService(
      [
        makeRow({
          sectionKey: 'discounts',
          displayOrder: 40,
          configJson: JSON.stringify({
            source: 'curated',
            fallbackSource: 'discount',
            limit: 8,
            productIds: [10, 999],
            seeAllLabel: 'همه',
          }),
        }),
      ],
      [10],
    );

    const result = await service.getPublicHome();
    const rail = result.sections[0].rail!;
    expect(rail.productIds).toEqual([10]);
    expect(rail.source).toBe('curated');
    expect(rail.limit).toBe(8);
  });

  it('falls back curated rail when all product ids inactive', async () => {
    const service = buildService(
      [
        makeRow({
          sectionKey: 'discounts',
          configJson: JSON.stringify({
            source: 'curated',
            fallbackSource: 'discount',
            productIds: [999],
          }),
        }),
      ],
      [],
    );
    const result = await service.getPublicHome();
    expect(result.sections[0].rail?.source).toBe('discount');
    expect(result.sections[0].rail?.productIds).toEqual([]);
  });

  it('rejects unknown section keys on admin upsert', async () => {
    const service = buildService([]);
    await expect(
      service.upsertAdminHome([
        {
          sectionKey: 'hack_component',
          enabled: true,
          displayOrder: 1,
        } as any,
      ]),
    ).rejects.toThrow(/نامعتبر/);
  });

  it('admin get does not invent keys outside whitelist', async () => {
    const service = buildService([
      makeRow({ sectionKey: 'campaign' }),
      makeRow({ sectionKey: 'evil' }),
    ]);
    const admin = await service.getAdminHome();
    expect(admin.sections.map((s) => s.sectionKey)).toEqual(['campaign']);
  });

  it('documents all architectural section keys', () => {
    expect(STOREFRONT_HOME_SECTION_KEYS).toContain('campaign');
    expect(STOREFRONT_HOME_SECTION_KEYS).toContain('newest');
    expect(STOREFRONT_HOME_SECTION_KEYS).toContain('discounts');
    expect(STOREFRONT_HOME_SECTION_KEYS).toContain('category_chapters');
  });
});
