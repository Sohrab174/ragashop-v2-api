import { discoveryEligibilitySql } from '../product/discovery-eligibility';
import { signHomePreviewCredential } from './home-preview-credential';
import { createHomeImageAccessMock } from './home-image-access.mock';
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
  const config = {
    app: { apiBaseUrl: 'http://127.0.0.1:9010' },
    auth: { secret: 'test-home-preview-secret' },
  };

  function buildService(rows: any[], productIds: number[] = [], categoryIds: number[] = []) {
    const sectionRepo: any = {
      find: jest.fn().mockResolvedValue(rows),
      findOne: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => v),
    };
    sectionRepo.manager = {
      transaction: async (fn: any) => fn({ getRepository: () => sectionRepo }),
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
      createHomeImageAccessMock(config.app.apiBaseUrl) as any,
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

  it('eligibility endpoint uses the public homepage filter and returns only matching ids', async () => {
    const clauses: unknown[] = [];
    let queriedIds: number[] = [];
    const productRepo = {
      createQueryBuilder: jest.fn(() => {
        const qb: any = {
          select: () => qb,
          where: (_sql: string, params: { ids: number[] }) => {
            queriedIds = params.ids;
            return qb;
          },
          andWhere: (sql: unknown) => {
            clauses.push(sql);
            return qb;
          },
          getMany: async () => [{ id: 5 }],
        };
        return qb;
      }),
    };
    const sectionRepo: any = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    sectionRepo.manager = {
      transaction: async (fn: any) => fn({ getRepository: () => sectionRepo }),
    };
    const service = new StorefrontHomeService(
      sectionRepo as any,
      productRepo as any,
      { find: jest.fn() } as any,
      { find: jest.fn() } as any,
      error as any,
      config as any,
      createHomeImageAccessMock(config.app.apiBaseUrl) as any,
    );

    const result = await service.findPublicHomepageEligibleProductIds('5,5,9');
    expect(result).toEqual({ eligibleIds: [5] });
    expect(queriedIds).toEqual([5, 9]);
    expect(clauses).toContain(discoveryEligibilitySql('product'));
    expect(JSON.stringify(clauses)).not.toContain('IN_SCOPE');
    expect(JSON.stringify(clauses)).not.toContain('category_assortment_resolution');
    expect(discoveryEligibilitySql('product')).toContain('sourceAvailability NOT IN');
    expect(sectionRepo.save).not.toHaveBeenCalled();
    expect(sectionRepo.find).not.toHaveBeenCalled();
  });

  it('eligibility endpoint rejects invalid and oversized id lists', async () => {
    const service = buildService([]);
    await expect(
      service.findPublicHomepageEligibleProductIds('5,abc'),
    ).rejects.toThrow(/نامعتبر/);
    const tooMany = Array.from({ length: 49 }, (_, index) => String(index + 1)).join(',');
    await expect(
      service.findPublicHomepageEligibleProductIds(tooMany),
    ).rejects.toThrow(/۴۸/);
  });
});

describe('StorefrontHomeService config persistence', () => {
  const error = {
    unprocessableEntity: jest.fn((msgs) => {
      throw new Error(msgs.join(','));
    }),
  };
  const config = {
    app: { apiBaseUrl: 'http://127.0.0.1:9010' },
    auth: { secret: 'test-home-preview-secret' },
  };

  function buildPersistingService(initialRows: any[]) {
    const store = new Map<string, any>(
      initialRows.map((row) => [row.sectionKey, { ...row }]),
    );
    const sectionRepo: any = {
      find: jest.fn(async () => [...store.values()]),
      findOne: jest.fn(async ({ where }: any) => {
        const row = store.get(where.sectionKey);
        return row ? { ...row } : null;
      }),
      create: jest.fn((v) => ({ ...v })),
      save: jest.fn(async (row) => {
        store.set(row.sectionKey, { ...row });
        return { ...row };
      }),
    };
    sectionRepo.manager = {
      transaction: async (fn: any) => {
        const snap = new Map(
          [...store.entries()].map(([k, v]) => [k, { ...v }]),
        );
        try {
          return await fn({ getRepository: () => sectionRepo });
        } catch (err) {
          store.clear();
          for (const [k, v] of snap) store.set(k, v);
          throw err;
        }
      },
    };
    const service = new StorefrontHomeService(
      sectionRepo as any,
      { createQueryBuilder: jest.fn() } as any,
      { find: jest.fn() } as any,
      { find: jest.fn() } as any,
      error as any,
      config as any,
      createHomeImageAccessMock(config.app.apiBaseUrl) as any,
    );
    return { service, store, sectionRepo };
  }

  it('keeps an existing unknown key across two updates and ignores client unknowns', async () => {
    const { service, store } = buildPersistingService([
      makeRow({
        sectionKey: 'campaign',
        configJson: JSON.stringify({
          ctaLabel: 'قدیم',
          preferredProductId: 9,
          legacyNote: 'keep-me',
        }),
      }),
    ]);

    await service.upsertAdminHome([
      {
        sectionKey: 'campaign',
        enabled: true,
        displayOrder: 10,
        config: {
          ctaLabel: 'جدید',
          preferredProductId: 9,
          clientHack: 'nope',
          legacyNote: 'overwrite-attempt',
        },
      } as any,
    ]);
    const afterFirst = JSON.parse(store.get('campaign').configJson);
    expect(afterFirst.ctaLabel).toBe('جدید');
    expect(afterFirst.legacyNote).toBe('keep-me');
    expect(afterFirst.clientHack).toBeUndefined();

    await service.upsertAdminHome([
      {
        sectionKey: 'campaign',
        enabled: true,
        displayOrder: 10,
        config: {
          ctaLabel: 'سوم',
          preferredProductId: 9,
          clientHack: 'still-nope',
        },
      } as any,
    ]);
    const afterSecond = JSON.parse(store.get('campaign').configJson);
    expect(afterSecond.ctaLabel).toBe('سوم');
    expect(afterSecond.legacyNote).toBe('keep-me');
    expect(afterSecond.clientHack).toBeUndefined();
  });

  it('preserves stored JSON when config is omitted', async () => {
    const previous = JSON.stringify({
      ctaLabel: 'حفظ',
      mystery: true,
    });
    const { service, store } = buildPersistingService([
      makeRow({ sectionKey: 'campaign', configJson: previous }),
    ]);

    await service.upsertAdminHome([
      {
        sectionKey: 'campaign',
        enabled: false,
        displayOrder: 12,
        title: 'عنوان',
      } as any,
    ]);

    expect(store.get('campaign').configJson).toBe(previous);
    expect(store.get('campaign').enabled).toBe(false);
    expect(store.get('campaign').title).toBe('عنوان');
  });

  it('removes omitted known fields from an explicit config', async () => {
    const { service, store } = buildPersistingService([
      makeRow({
        sectionKey: 'campaign',
        configJson: JSON.stringify({
          ctaLabel: 'حذف‌شو',
          preferredProductId: 5,
          mystery: 1,
        }),
      }),
    ]);

    await service.upsertAdminHome([
      {
        sectionKey: 'campaign',
        enabled: true,
        displayOrder: 10,
        config: { preferredProductId: 5 },
      } as any,
    ]);

    const next = JSON.parse(store.get('campaign').configJson);
    expect(next.ctaLabel).toBeUndefined();
    expect(next.preferredProductId).toBe(5);
    expect(next.mystery).toBe(1);
  });

  it('preserves automatic-section JSON when the client sends {}', async () => {
    const previous = JSON.stringify({ slideTheme: 'legacy' });
    const { service, store } = buildPersistingService([
      makeRow({ sectionKey: 'paste_link', configJson: previous }),
      makeRow({
        sectionKey: 'discounts',
        configJson: JSON.stringify({ source: 'discount', limit: 8 }),
      }),
    ]);

    await service.upsertAdminHome([
      {
        sectionKey: 'paste_link',
        enabled: true,
        displayOrder: 14,
        config: {},
      } as any,
      {
        sectionKey: 'discounts',
        enabled: true,
        displayOrder: 40,
        config: { source: 'discount', limit: 10 },
      } as any,
    ]);

    expect(store.get('paste_link').configJson).toBe(previous);
    expect(JSON.parse(store.get('discounts').configJson)).toEqual({
      source: 'discount',
      limit: 10,
      productIds: [],
    });
  });

  it('stores a Trendyol button label and can clear it', async () => {
    const { service, store } = buildPersistingService([
      makeRow({ sectionKey: 'paste_link', configJson: '{"slideTheme":"legacy"}' }),
    ]);

    await service.upsertAdminHome([
      {
        sectionKey: 'paste_link',
        enabled: true,
        displayOrder: 14,
        title: 'خرید با لینک',
        config: { ctaLabel: 'ادامه' },
      } as any,
    ]);

    expect(JSON.parse(store.get('paste_link').configJson)).toEqual({
      ctaLabel: 'ادامه',
      slideTheme: 'legacy',
    });

    await service.upsertAdminHome([
      {
        sectionKey: 'paste_link',
        enabled: true,
        displayOrder: 14,
        config: { ctaLabel: '' },
      } as any,
    ]);

    expect(JSON.parse(store.get('paste_link').configJson)).toEqual({
      slideTheme: 'legacy',
    });

    const mapped = await service.mapAdminSectionsToPublic([
      {
        sectionKey: 'paste_link',
        enabled: true,
        displayOrder: 14,
        title: 'خرید با لینک',
        subtitle: 'آدرس ترندیول را بچسبانید',
        config: { ctaLabel: 'ادامه' },
      } as any,
    ]);
    expect(mapped.sections[0]).toMatchObject({
      key: 'paste_link',
      title: 'خرید با لینک',
      subtitle: 'آدرس ترندیول را بچسبانید',
      ctaLabel: 'ادامه',
    });
  });

  it('leaves an unrelated section untouched', async () => {
    const { service, store, sectionRepo } = buildPersistingService([
      makeRow({
        sectionKey: 'campaign',
        configJson: JSON.stringify({ ctaLabel: 'a' }),
      }),
      makeRow({
        sectionKey: 'discounts',
        configJson: JSON.stringify({ source: 'curated', productIds: [1, 2] }),
      }),
    ]);
    const beforeDiscounts = store.get('discounts').configJson;

    await service.upsertAdminHome([
      {
        sectionKey: 'campaign',
        enabled: true,
        displayOrder: 10,
        config: { ctaLabel: 'b' },
      } as any,
    ]);

    expect(store.get('discounts').configJson).toBe(beforeDiscounts);
    expect(sectionRepo.save).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.get('campaign').configJson).ctaLabel).toBe('b');
  });

  it('keeps spotlight default limit 6 and accepts a normal campaign update', async () => {
    const { service, store } = buildPersistingService([
      makeRow({
        sectionKey: 'category_spotlight',
        configJson: JSON.stringify({ limit: 4 }),
      }),
      makeRow({
        sectionKey: 'campaign',
        configJson: JSON.stringify({ ctaLabel: 'قبل' }),
      }),
    ]);

    await service.upsertAdminHome([
      {
        sectionKey: 'category_spotlight',
        enabled: true,
        displayOrder: 28,
        config: {},
      } as any,
      {
        sectionKey: 'campaign',
        enabled: true,
        displayOrder: 10,
        title: 'بنر',
        config: {
          ctaLabel: 'مشاهده',
          preferredProductId: 11,
          ctaDestinationType: 'product',
        },
      } as any,
    ]);

    expect(JSON.parse(store.get('category_spotlight').configJson)).toEqual({
      limit: 6,
    });
    expect(JSON.parse(store.get('campaign').configJson)).toEqual({
      ctaLabel: 'مشاهده',
      preferredProductId: 11,
      ctaDestinationType: 'product',
    });
  });
});

describe('StorefrontHomeService unpublished preview sessions', () => {
  const error = {
    unprocessableEntity: jest.fn((msgs) => {
      throw new Error(msgs.join(','));
    }),
    unauthorized: jest.fn((msgs) => {
      throw new Error(msgs.join(','));
    }),
    notFound: jest.fn((msgs) => {
      throw new Error(msgs.join(','));
    }),
  };
  const config = {
    app: { apiBaseUrl: 'http://127.0.0.1:9010' },
    auth: { secret: 'test-home-preview-secret' },
  };

  function buildService(productIds: number[] = []) {
    const sectionRepo: any = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn(async () => {
        throw new Error('preview must not save homepage rows');
      }),
    };
    sectionRepo.manager = {
      transaction: async (fn: any) => fn({ getRepository: () => sectionRepo }),
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
    const categoryRepo = { find: jest.fn().mockResolvedValue([]) };
    const canonicalCategoryRepo = { find: jest.fn().mockResolvedValue([]) };
    return new StorefrontHomeService(
      sectionRepo as any,
      productRepo as any,
      categoryRepo as any,
      canonicalCategoryRepo as any,
      error as any,
      config as any,
      createHomeImageAccessMock(config.app.apiBaseUrl) as any,
    );
  }

  beforeEach(() => {
    const service = buildService();
    service.clearHomePreviewSessionsForTests();
  });

  it('maps Admin sections to the public DTO without saving', async () => {
    const service = buildService([42]);
    const mapped = await service.mapAdminSectionsToPublic([
      {
        sectionKey: 'campaign',
        enabled: true,
        displayOrder: 10,
        title: 'پیش‌نمایش بنر',
        config: {
          ctaLabel: 'ببین',
          preferredProductId: 42,
          desktopImagePath: '/home/demo.webp',
          mystery: 'keep-out-of-public',
        },
      } as any,
      {
        sectionKey: 'paste_link',
        enabled: true,
        displayOrder: 50,
        title: 'داستان‌ها',
        config: {},
      } as any,
    ]);

    expect(mapped.sections.map((s) => s.key)).toEqual(['campaign', 'paste_link']);
    expect(mapped.sections[0].hero?.title).toBe('پیش‌نمایش بنر');
    expect(mapped.sections[0].hero?.preferredProductId).toBe(42);
    expect(mapped.sections[0].hero?.desktopImageUrl).toContain('/static/home/demo.webp');
    expect((mapped.sections[0] as any).mystery).toBeUndefined();
    expect((service as any).sectionRepo.save).not.toHaveBeenCalled();
  });

  it('creates a preview-only credential and requires a redeemed handoff', async () => {
    const service = buildService([7]);
    const created = await service.createHomePreviewSession(
      [
        {
          sectionKey: 'campaign',
          enabled: true,
          displayOrder: 10,
          title: 'Tok',
          config: { preferredProductId: 7, ctaLabel: 'Go' },
        } as any,
      ],
      5,
    );
    expect(created.token).toMatch(/^[a-f0-9]{64}$/);
    expect(created.credential.split('.')).toHaveLength(2);
    expect(created.handoffNonce).toMatch(/^[a-f0-9]{32}$/);
    expect(Date.parse(created.expiresAt)).toBeGreaterThan(Date.now());

    expect(() =>
      service.getHomePreviewSession(created.token, created.credential),
    ).toThrow(/مجاز نیست/);

    service.redeemHomePreviewHandoff(
      created.token,
      created.credential,
      created.handoffNonce,
    );
    const payload = service.getHomePreviewSession(
      created.token,
      created.credential,
    );
    expect(payload.sections[0].hero?.title).toBe('Tok');

    // Same nonce may be redeemed again (iframe cookie retry). Wrong nonce cannot.
    expect(() =>
      service.redeemHomePreviewHandoff(
        created.token,
        created.credential,
        created.handoffNonce,
      ),
    ).not.toThrow();
    expect(() =>
      service.redeemHomePreviewHandoff(
        created.token,
        created.credential,
        'f'.repeat(32),
      ),
    ).toThrow(/مجاز نیست/);
    expect(() => service.getHomePreviewSession(created.token, '')).toThrow(
      /مجاز نیست/,
    );
    expect(() =>
      service.getHomePreviewSession('a'.repeat(64), created.credential),
    ).toThrow(/مجاز نیست|پیش‌نمایش/);
  });

  it('rejects forged, wrong-owner, and wrong-session credentials', async () => {
    const service = buildService([7]);
    const sections = [
      {
        sectionKey: 'campaign',
        enabled: true,
        displayOrder: 10,
        title: 'Own',
        config: { preferredProductId: 7, ctaLabel: 'Go' },
      } as any,
    ];
    const owner = await service.createHomePreviewSession(sections, 5);
    const other = await service.createHomePreviewSession(sections, 9);
    service.redeemHomePreviewHandoff(owner.token, owner.credential, owner.handoffNonce);

    const forged = signHomePreviewCredential(
      {
        sid: owner.token,
        sub: 5,
        exp: Math.floor(Date.now() / 1000) + 60,
        nonce: owner.handoffNonce,
      },
      'wrong-secret',
    );
    expect(() => service.getHomePreviewSession(owner.token, forged)).toThrow(
      /مجاز نیست/,
    );
    expect(() =>
      service.getHomePreviewSession(owner.token, other.credential),
    ).toThrow(/مجاز نیست/);
    expect(() =>
      service.redeemHomePreviewHandoff(
        other.token,
        owner.credential,
        other.handoffNonce,
      ),
    ).toThrow(/مجاز نیست/);

    const viaOwner = service.getHomePreviewSession(owner.token, owner.credential);
    expect(viaOwner.sections[0].hero?.title).toBe('Own');
  });

  it('rejects retrieval after the preview session expires', async () => {
    const service = buildService([7]);
    const created = await service.createHomePreviewSession(
      [
        {
          sectionKey: 'campaign',
          enabled: true,
          displayOrder: 10,
          title: 'Exp',
          config: { preferredProductId: 7, ctaLabel: 'Go' },
        } as any,
      ],
      5,
    );
    service.redeemHomePreviewHandoff(
      created.token,
      created.credential,
      created.handoffNonce,
    );
    expect(
      service.getHomePreviewSession(created.token, created.credential).sections[0]
        .hero?.title,
    ).toBe('Exp');
    service.expireHomePreviewSessionForTests(created.token);
    expect(() =>
      service.getHomePreviewSession(created.token, created.credential),
    ).toThrow(/پیش‌نمایش/);
  });

  it('caps per-user preview sessions', async () => {
    const service = buildService([7]);
    const sections = [
      {
        sectionKey: 'campaign',
        enabled: true,
        displayOrder: 10,
        title: 'Cap',
        config: { preferredProductId: 7, ctaLabel: 'Go' },
      } as any,
    ];
    for (let i = 0; i < 7; i += 1) {
      await service.createHomePreviewSession(sections, 3);
    }
    expect(service.countHomePreviewSessionsForTests()).toBeLessThanOrEqual(5);
  });

  it('omits ineligible preferred products from the preview payload', async () => {
    const service = buildService([]);
    const mapped = await service.mapAdminSectionsToPublic([
      {
        sectionKey: 'campaign',
        enabled: true,
        displayOrder: 10,
        title: 'بنر',
        config: { preferredProductId: 155209, ctaLabel: 'x' },
      } as any,
    ]);
    expect(mapped.sections[0].hero?.preferredProductId).toBeUndefined();
  });
});

describe('StorefrontHomeService atomic publish', () => {
  const error = {
    unprocessableEntity: jest.fn((msgs) => {
      throw new Error(msgs.join(','));
    }),
  };
  const config = {
    app: { apiBaseUrl: 'http://127.0.0.1:9010' },
    auth: { secret: 'test-home-preview-secret' },
  };

  it('rolls back earlier section writes when a later save fails', async () => {
    const store = new Map<string, any>([
      [
        'campaign',
        {
          id: 1,
          sectionKey: 'campaign',
          enabled: true,
          displayOrder: 10,
          title: 'قبل',
          subtitle: null,
          configJson: JSON.stringify({ ctaLabel: 'قدیم' }),
          startAt: null,
          endAt: null,
        },
      ],
      [
        'newest',
        {
          id: 2,
          sectionKey: 'newest',
          enabled: true,
          displayOrder: 20,
          title: 'جدید قبل',
          subtitle: null,
          configJson: JSON.stringify({ source: 'newest', limit: 8 }),
          startAt: null,
          endAt: null,
        },
      ],
    ]);
    let saveCount = 0;
    const sectionRepo: any = {
      find: jest.fn(async () => [...store.values()]),
      findOne: jest.fn(async ({ where }: any) => {
        const row = store.get(where.sectionKey);
        return row ? { ...row } : null;
      }),
      create: jest.fn((v) => ({ ...v })),
      save: jest.fn(async (row) => {
        saveCount += 1;
        if (saveCount === 2) {
          throw new Error('simulated mid-publish failure');
        }
        store.set(row.sectionKey, { ...row });
        return { ...row };
      }),
    };
    sectionRepo.manager = {
      transaction: async (fn: any) => {
        const snap = new Map(
          [...store.entries()].map(([k, v]) => [k, { ...v }]),
        );
        try {
          return await fn({ getRepository: () => sectionRepo });
        } catch (err) {
          store.clear();
          for (const [k, v] of snap) store.set(k, v);
          throw err;
        }
      },
    };
    const service = new StorefrontHomeService(
      sectionRepo as any,
      { createQueryBuilder: jest.fn() } as any,
      { find: jest.fn() } as any,
      { find: jest.fn() } as any,
      error as any,
      config as any,
      createHomeImageAccessMock(config.app.apiBaseUrl) as any,
    );

    await expect(
      service.upsertAdminHome([
        {
          sectionKey: 'campaign',
          enabled: true,
          displayOrder: 10,
          title: 'بعد',
          config: { ctaLabel: 'جدید' },
        } as any,
        {
          sectionKey: 'newest',
          enabled: true,
          displayOrder: 20,
          title: 'جدید بعد',
          config: { source: 'newest', limit: 12 },
        } as any,
      ]),
    ).rejects.toThrow(/simulated mid-publish failure/);

    expect(JSON.parse(store.get('campaign').configJson)).toEqual({
      ctaLabel: 'قدیم',
    });
    expect(store.get('campaign').title).toBe('قبل');
    expect(store.get('newest').title).toBe('جدید قبل');
  });
});
