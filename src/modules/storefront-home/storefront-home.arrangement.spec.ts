import { readFileSync } from 'fs';
import { join } from 'path';
import { StorefrontHomeSectionInstanceEntity } from './entities/storefront-home-section-instance.entity';
import { StorefrontHomeService } from './storefront-home.service';

function arrangementService(sectionRows: Array<Record<string, unknown>> = []) {
  const sections = sectionRows.map((row) => ({ ...row }));
  const instances: Array<Record<string, unknown>> = [];
  let nextId = 1;
  const sectionRepo: any = {
    find: jest.fn(async () => sections),
    save: jest.fn(() => {
      throw new Error('singleton section save');
    }),
    delete: jest.fn(() => {
      throw new Error('singleton section delete');
    }),
    update: jest.fn(() => {
      throw new Error('singleton section update');
    }),
    createQueryBuilder: jest.fn(() => {
      throw new Error('singleton section query');
    }),
  };
  const instanceRepo: any = {
    create: (row: Record<string, unknown>) => ({ ...row }),
    find: jest.fn(async () => instances.map((row) => ({ ...row }))),
    manager: {
      transaction: async (fn: (manager: any) => Promise<void>) => {
        const snapshot = instances.map((row) => ({ ...row }));
        const txRepo = {
          create: (row: Record<string, unknown>) => ({ ...row }),
          save: async (row: any) => {
            const list = Array.isArray(row) ? row : [row];
            for (const item of list) {
              instances.push({ id: nextId++, ...item });
            }
          },
          createQueryBuilder: () => ({
            delete: () => ({
              from: () => ({
                execute: async () => {
                  instances.splice(0, instances.length);
                },
              }),
            }),
          }),
        };
        try {
          await fn({ getRepository: () => txRepo });
        } catch (error) {
          instances.splice(0, instances.length, ...snapshot);
          throw error;
        }
      },
    },
  };
  const error = {
    unprocessableEntity: (messages: string[]) => {
      throw new Error(messages.join(' '));
    },
    unauthorized: (messages: string[]) => {
      throw new Error(messages.join(' '));
    },
    notFound: (messages: string[]) => {
      throw new Error(messages.join(' '));
    },
  };
  const service = new StorefrontHomeService(
    sectionRepo,
    { createQueryBuilder: jest.fn() } as any,
    { find: jest.fn().mockResolvedValue([]) } as any,
    { find: jest.fn().mockResolvedValue([]) } as any,
    error as any,
    { app: { apiBaseUrl: 'http://127.0.0.1:9010' }, auth: { secret: 'x' } } as any,
    instanceRepo,
  );
  return { service, sections, instances, sectionRepo };
}

const legacyCampaign = {
  instanceKey: 'legacy:campaign',
  sectionType: 'hero',
  enabled: true,
  displayOrder: 10,
  title: 'اسلایدر',
  subtitle: null,
  config: { ctaLabel: 'مشاهده' },
};

const legacyDiscounts = {
  instanceKey: 'legacy:discounts',
  sectionType: 'product_rail',
  enabled: true,
  displayOrder: 20,
  title: 'پیشنهادها',
  subtitle: null,
  config: {},
};

describe('storefront home arrangement', () => {
  it('migration only creates the instance table', () => {
    const source = readFileSync(
      join(
        __dirname,
        '../../database/migrations/1920000000010-phase-home-section-instances.ts',
      ),
      'utf8',
    );
    expect(source).toContain('storefront_home_section_instance');
    expect(source).toMatch(/CREATE TABLE/);
    expect(source).not.toMatch(/UPDATE\s+`storefront_home_section`/i);
    expect(source).not.toMatch(/DELETE\s+FROM\s+`storefront_home_section`/i);
    expect(source).not.toMatch(/INSERT\s+INTO\s+`storefront_home_section`/i);
    expect(source).not.toMatch(/ALTER\s+TABLE\s+`storefront_home_section`/i);
    expect(source).toContain('DROP TABLE `storefront_home_section_instance`');
  });

  it('keeps the singleton homepage when no arrangement has been published', async () => {
    const { service } = arrangementService([
      {
        id: 1,
        sectionKey: 'campaign',
        enabled: true,
        displayOrder: 10,
        title: 'Hero',
        configJson: '{}',
        startAt: null,
        endAt: null,
      },
    ]);
    const pub = await service.getPublicHome();
    expect(pub.layout).toBeUndefined();
    expect(pub.sections.map((row) => row.key)).toEqual(['campaign']);
    const admin = await service.getAdminHome();
    expect(admin.arrangement).toEqual({ managed: false, instances: [] });
  });

  it('first publish writes the marker and leaves singleton rows unchanged', async () => {
    const { service, sections, instances, sectionRepo } = arrangementService([
      { id: 4, sectionKey: 'campaign', enabled: true, displayOrder: 10, title: 'Hero' },
    ]);
    const published = await service.publishHomeArrangement([legacyCampaign, legacyDiscounts]);
    expect(published.managed).toBe(true);
    expect(published.instances.map((row) => row.instanceKey)).toEqual([
      'legacy:campaign',
      'legacy:discounts',
    ]);
    expect(instances.map((row) => row.instanceKey)).toEqual([
      'layout:published',
      'legacy:campaign',
      'legacy:discounts',
    ]);
    expect(sections).toEqual([
      { id: 4, sectionKey: 'campaign', enabled: true, displayOrder: 10, title: 'Hero' },
    ]);
    expect(sectionRepo.save).not.toHaveBeenCalled();
    expect(sectionRepo.delete).not.toHaveBeenCalled();
    expect(sectionRepo.update).not.toHaveBeenCalled();
    const again = await service.getAdminHome();
    expect(again.arrangement.instances.map((row) => row.instanceKey)).toEqual([
      'legacy:campaign',
      'legacy:discounts',
    ]);
  });

  it('publishes a mixed legacy and new arrangement without deleting singleton rows', async () => {
    const { service, sections } = arrangementService([
      { id: 1, sectionKey: 'campaign', title: 'keep' },
      { id: 2, sectionKey: 'discounts', title: 'keep-discounts' },
    ]);
    const published = await service.publishHomeArrangement([
      legacyCampaign,
      {
        instanceKey: 'inst_0123456789abcdef',
        sectionType: 'hero',
        enabled: true,
        displayOrder: 15,
        title: 'اسلایدر دوم',
        config: { slides: [] },
      },
      legacyDiscounts,
    ]);
    expect(published.instances.map((row) => row.instanceKey)).toEqual([
      'legacy:campaign',
      'inst_0123456789abcdef',
      'legacy:discounts',
    ]);
    expect(sections.map((row) => row.sectionKey)).toEqual(['campaign', 'discounts']);
  });

  it('removal drops only the arrangement row and an empty publish does not fall back', async () => {
    const { service, sections } = arrangementService([
      { id: 1, sectionKey: 'campaign', title: 'still-here' },
      { id: 2, sectionKey: 'discounts', title: 'still-here' },
    ]);
    await service.publishHomeArrangement([legacyCampaign, legacyDiscounts]);
    const removed = await service.publishHomeArrangement([legacyCampaign]);
    expect(removed.instances.map((row) => row.instanceKey)).toEqual(['legacy:campaign']);
    expect(sections.map((row) => row.sectionKey)).toEqual(['campaign', 'discounts']);

    const emptied = await service.publishHomeArrangement([]);
    expect(emptied).toEqual({ managed: true, instances: [] });
    const pub = await service.getPublicHome();
    expect(pub.layout).toEqual({ managed: true, instances: [] });
    expect(pub.sections.map((row) => row.key)).toEqual(['campaign', 'discounts']);
    expect(sections.map((row) => row.sectionKey)).toEqual(['campaign', 'discounts']);
  });

  it('returns published instances in display order', async () => {
    const { service } = arrangementService([]);
    await service.publishHomeArrangement([
      { ...legacyDiscounts, displayOrder: 40, title: 'دوم' },
      { ...legacyCampaign, displayOrder: 10, title: 'اول' },
    ]);
    const pub = await service.getPublicHome();
    expect(pub.layout?.instances.map((row) => row.instanceKey)).toEqual([
      'legacy:campaign',
      'legacy:discounts',
    ]);
    expect(pub.layout?.instances[0].section.key).toBe('campaign');
    expect(pub.layout?.instances[1].section.title).toBe('دوم');
  });

  it('rejects header, footer, search and checkout in the repeatable library', async () => {
    const { service } = arrangementService([]);
    await expect(
      service.publishHomeArrangement([
        {
          instanceKey: 'inst_0123456789abcdef',
          sectionType: 'site_header',
          enabled: true,
          displayOrder: 1,
        },
      ]),
    ).rejects.toThrow(/سربرگ/);
    await expect(
      service.publishHomeArrangement([
        {
          instanceKey: 'inst_0123456789abcdef',
          sectionType: 'checkout',
          enabled: true,
          displayOrder: 1,
        },
      ]),
    ).rejects.toThrow(/تسویه/);
  });

  it('rolls the arrangement back when the write fails', async () => {
    const { service, instances } = arrangementService([]);
    await service.publishHomeArrangement([legacyCampaign]);
    const instanceRepo = (service as any).instanceRepo;
    instanceRepo.manager.transaction = async (fn: any) => {
      const snapshot = instances.map((row) => ({ ...row }));
      const txRepo = {
        create: (row: Record<string, unknown>) => ({ ...row }),
        save: async () => {
          throw new Error('disk full');
        },
        createQueryBuilder: () => ({
          delete: () => ({
            from: () => ({
              execute: async () => {
                instances.splice(0, instances.length);
              },
            }),
          }),
        }),
      };
      try {
        await fn({ getRepository: () => txRepo });
      } catch (error) {
        instances.splice(0, instances.length, ...snapshot);
        throw error;
      }
    };
    await expect(service.publishHomeArrangement([])).rejects.toThrow(/disk full/);
    expect(instances.map((row) => row.instanceKey)).toEqual([
      'layout:published',
      'legacy:campaign',
    ]);
    expect(StorefrontHomeSectionInstanceEntity).toBeTruthy();
  });
});

function atomicPublishService(options?: {
  failSectionSaveAt?: number;
  failInstanceSaveAt?: number;
  holdFirstTransactionMs?: number;
}) {
  const sectionStore = new Map<string, Record<string, unknown>>();
  sectionStore.set('campaign', {
    id: 1,
    sectionKey: 'campaign',
    enabled: true,
    displayOrder: 10,
    title: 'قبل',
    subtitle: null,
    configJson: JSON.stringify({ ctaLabel: 'قدیم' }),
    startAt: null,
    endAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: null,
  });
  sectionStore.set('paste_link', {
    id: 2,
    sectionKey: 'paste_link',
    enabled: true,
    displayOrder: 14,
    title: 'ترندیول',
    subtitle: null,
    configJson: '{}',
    startAt: null,
    endAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: null,
  });
  const instanceStore: Array<Record<string, unknown>> = [
    {
      id: 1,
      instanceKey: 'layout:published',
      sectionType: 'layout',
      enabled: true,
      displayOrder: 0,
      title: null,
      subtitle: null,
      configJson: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: null,
    },
    {
      id: 2,
      instanceKey: 'legacy:campaign',
      sectionType: 'hero',
      enabled: true,
      displayOrder: 10,
      title: 'اسلایدر قبلی',
      subtitle: null,
      configJson: '{}',
      createdAt: new Date('2026-01-01'),
      updatedAt: null,
    },
  ];
  let sectionSaves = 0;
  let instanceSaves = 0;
  let active = 0;
  let maxActive = 0;
  let transactions = 0;
  const sectionRepo: any = {
    find: jest.fn(async () => [...sectionStore.values()].map((row) => ({ ...row }))),
    findOne: jest.fn(async ({ where }: { where: { sectionKey: string } }) => {
      const row = sectionStore.get(where.sectionKey);
      return row ? { ...row } : null;
    }),
    create: jest.fn((row: Record<string, unknown>) => ({ ...row })),
    save: jest.fn(async (row: Record<string, unknown>) => {
      sectionSaves += 1;
      if (options?.failSectionSaveAt && sectionSaves === options.failSectionSaveAt) {
        throw new Error('section write failed');
      }
      sectionStore.set(String(row.sectionKey), { ...row });
      return { ...row };
    }),
  };
  const instanceRepo: any = {
    find: jest.fn(async () => instanceStore.map((row) => ({ ...row }))),
    create: jest.fn((row: Record<string, unknown>) => ({ ...row })),
    save: jest.fn(async (row: any) => {
      const list = Array.isArray(row) ? row : [row];
      for (const item of list) {
        instanceSaves += 1;
        if (options?.failInstanceSaveAt && instanceSaves === options.failInstanceSaveAt) {
          throw new Error('arrangement write failed');
        }
        instanceStore.push({ id: instanceStore.length + 1, ...item });
      }
      return row;
    }),
    createQueryBuilder: () => ({
      delete: () => ({
        from: () => ({
          execute: async () => {
            instanceStore.splice(0, instanceStore.length);
          },
        }),
      }),
    }),
  };
  const manager = {
    transaction: async (fn: (tx: any) => Promise<void>) => {
      transactions += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (options?.holdFirstTransactionMs && transactions === 1) {
        await new Promise((resolve) => setTimeout(resolve, options.holdFirstTransactionMs));
      }
      const sectionSnap = new Map(
        [...sectionStore.entries()].map(([key, value]) => [key, { ...value }]),
      );
      const instanceSnap = instanceStore.map((row) => ({ ...row }));
      try {
        const result = await fn({
          getRepository: (entity: unknown) =>
            entity === StorefrontHomeSectionInstanceEntity ? instanceRepo : sectionRepo,
        });
        active -= 1;
        return result;
      } catch (error) {
        active -= 1;
        sectionStore.clear();
        for (const [key, value] of sectionSnap) sectionStore.set(key, value);
        instanceStore.splice(0, instanceStore.length, ...instanceSnap);
        throw error;
      }
    },
  };
  sectionRepo.manager = manager;
  instanceRepo.manager = manager;
  const error = {
    unprocessableEntity: (messages: string[]) => {
      throw new Error(messages.join(' '));
    },
    unauthorized: (messages: string[]) => {
      throw new Error(messages.join(' '));
    },
    notFound: (messages: string[]) => {
      throw new Error(messages.join(' '));
    },
  };
  const service = new StorefrontHomeService(
    sectionRepo,
    { createQueryBuilder: jest.fn() } as any,
    { find: jest.fn().mockResolvedValue([]) } as any,
    { find: jest.fn().mockResolvedValue([]) } as any,
    error as any,
    { app: { apiBaseUrl: 'http://127.0.0.1:9010' }, auth: { secret: 'x' } } as any,
    instanceRepo,
  );
  return {
    service,
    sectionStore,
    instanceStore,
    stats: () => ({ maxActive, transactions }),
  };
}

const sectionPayload = [
  {
    sectionKey: 'campaign',
    enabled: true,
    displayOrder: 10,
    title: 'بعد',
    config: { ctaLabel: 'جدید' },
  },
  {
    sectionKey: 'paste_link',
    enabled: true,
    displayOrder: 14,
    title: 'جستجو',
    config: { ctaLabel: 'شروع' },
  },
];

describe('atomic homepage publish', () => {
  it('publishes singleton content and the arrangement together', async () => {
    const { service, sectionStore, instanceStore } = atomicPublishService();
    const saved = await service.upsertAdminHome(sectionPayload as any, [
      legacyCampaign,
      {
        instanceKey: 'inst_0123456789abcdef',
        sectionType: 'hero',
        enabled: true,
        displayOrder: 20,
        title: 'اسلایدر دوم',
        config: {},
      },
    ]);
    expect(sectionStore.get('campaign')?.title).toBe('بعد');
    expect(saved.arrangement.managed).toBe(true);
    expect(saved.arrangement.instances.map((row) => row.instanceKey)).toEqual([
      'legacy:campaign',
      'inst_0123456789abcdef',
    ]);
    expect(instanceStore.some((row) => row.instanceKey === 'layout:published')).toBe(true);
    const pub = await service.getPublicHome();
    expect(pub.layout?.managed).toBe(true);
    expect(pub.sections.find((row) => row.key === 'campaign')?.title).toBe('بعد');
  });

  it('rolls the arrangement back when a singleton write fails', async () => {
    const { service, sectionStore, instanceStore } = atomicPublishService({
      failSectionSaveAt: 1,
    });
    await expect(
      service.upsertAdminHome(sectionPayload as any, [legacyCampaign, legacyDiscounts]),
    ).rejects.toThrow(/section write failed/);
    expect(sectionStore.get('campaign')?.title).toBe('قبل');
    expect(instanceStore.map((row) => row.instanceKey)).toEqual([
      'layout:published',
      'legacy:campaign',
    ]);
    const pub = await service.getPublicHome();
    expect(pub.layout?.instances.map((row) => row.title)).toEqual(['اسلایدر قبلی']);
  });

  it('rolls singleton changes back when the arrangement write fails', async () => {
    const { service, sectionStore, instanceStore } = atomicPublishService({
      failInstanceSaveAt: 2,
    });
    await expect(
      service.upsertAdminHome(sectionPayload as any, [legacyCampaign, legacyDiscounts]),
    ).rejects.toThrow(/arrangement write failed/);
    expect(sectionStore.get('campaign')?.title).toBe('قبل');
    expect(JSON.parse(String(sectionStore.get('campaign')?.configJson)).ctaLabel).toBe('قدیم');
    expect(instanceStore.map((row) => row.instanceKey)).toEqual([
      'layout:published',
      'legacy:campaign',
    ]);
  });

  it('runs overlapping publishes one at a time', async () => {
    const { service, stats } = atomicPublishService({ holdFirstTransactionMs: 40 });
    const first = service.upsertAdminHome(sectionPayload as any, [legacyCampaign]);
    const second = service.upsertAdminHome(
      [{ ...sectionPayload[0], title: 'سوم' }, sectionPayload[1]] as any,
      [legacyDiscounts],
    );
    await Promise.all([first, second]);
    expect(stats().maxActive).toBe(1);
    expect(stats().transactions).toBe(2);
    const saved = await service.getAdminHome();
    expect(saved.sections.find((row) => row.sectionKey === 'campaign')?.title).toBe('سوم');
    expect(saved.arrangement.instances.map((row) => row.instanceKey)).toEqual([
      'legacy:discounts',
    ]);
  });

  it('keeps an unpublished homepage on singleton rows and an empty arrangement distinct', async () => {
    const fresh = atomicPublishService();
    fresh.instanceStore.splice(0, fresh.instanceStore.length);
    const sectionsOnly = await fresh.service.upsertAdminHome(sectionPayload as any);
    expect(sectionsOnly.arrangement).toEqual({ managed: false, instances: [] });
    expect(fresh.instanceStore).toEqual([]);
    const pub = await fresh.service.getPublicHome();
    expect(pub.layout).toBeUndefined();
    expect(pub.sections.find((row) => row.key === 'campaign')?.title).toBe('بعد');

    const emptied = await fresh.service.upsertAdminHome(sectionPayload as any, []);
    expect(emptied.arrangement).toEqual({ managed: true, instances: [] });
    const emptyPub = await fresh.service.getPublicHome();
    expect(emptyPub.layout).toEqual({ managed: true, instances: [] });
    expect(emptyPub.sections.map((row) => row.key)).toEqual(['campaign', 'paste_link']);
  });

  it('rejects an invalid arrangement before either table changes', async () => {
    const { service, sectionStore, instanceStore } = atomicPublishService();
    await expect(
      service.upsertAdminHome(sectionPayload as any, [
        {
          instanceKey: 'inst_0123456789abcdef',
          sectionType: 'checkout',
          enabled: true,
          displayOrder: 10,
        },
      ] as any),
    ).rejects.toThrow(/تسویه/);
    expect(sectionStore.get('campaign')?.title).toBe('قبل');
    expect(instanceStore.map((row) => row.instanceKey)).toEqual([
      'layout:published',
      'legacy:campaign',
    ]);
  });
});
