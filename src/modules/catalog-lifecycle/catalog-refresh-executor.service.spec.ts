import { CatalogRefreshExecutorService } from './catalog-refresh-executor.service';
import { ProductSupplyType } from './catalog-lifecycle.types';
import {
  SourceCommercialAvailability,
  SourceSyncStatus,
} from '../source-availability';
import {
  CATALOG_REFRESH_CHECKPOINT_SCOPE_KEY_MAX_LENGTH,
  CATALOG_REFRESH_SOURCE_FILTER_MAX_LENGTH,
  catalogRefreshCheckpointScopeKey,
} from './entities/catalog-refresh-checkpoint.entity';

function mockCartRepo(productIds: number[] = []) {
  return {
    createQueryBuilder: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockResolvedValue(productIds.map((productId) => ({ productId }))),
    })),
  };
}

/** In-memory revision-aware checkpoint store. */
function createCheckpointStore(initialCursor = 0, initialRevision = 0) {
  let afterProductId = initialCursor;
  let revision = initialRevision;
  let initialized = initialRevision > 0 || initialCursor > 0;

  return {
    get: () => ({ afterProductId, revision, initialized }),
    repo: {
      findOne: jest.fn(async () => {
        if (!initialized && afterProductId === 0 && revision === 0) {
          return null;
        }
        return {
          scopeKey: 'global',
          afterProductId,
          revision,
        };
      }),
      insert: jest.fn(async (row: {
        afterProductId: number;
        revision: number;
      }) => {
        if (initialized) {
          const err: any = new Error('Duplicate entry');
          err.code = 'ER_DUP_ENTRY';
          err.errno = 1062;
          throw err;
        }
        afterProductId = Number(row.afterProductId);
        revision = Number(row.revision);
        initialized = true;
      }),
      createQueryBuilder: jest.fn(() => {
        let expectedRev = -1;
        let nextCursor = 0;
        let nextRev = 0;
        const qb: any = {
          update: jest.fn().mockReturnThis(),
          set: jest.fn((vals: any) => {
            nextCursor = Number(vals.afterProductId);
            nextRev = Number(vals.revision);
            return qb;
          }),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn((_s: string, p: any) => {
            if (p?.expectedRev != null) expectedRev = Number(p.expectedRev);
            return qb;
          }),
          execute: jest.fn(async () => {
            if (revision !== expectedRev) return { affected: 0 };
            afterProductId = nextCursor;
            revision = nextRev;
            initialized = true;
            return { affected: 1 };
          }),
        };
        return qb;
      }),
    },
  };
}

function freshAvailable(id: number, confirmedAt: Date) {
  return {
    id,
    source: 'trendyol',
    sourceId: `s${id}`,
    sourceUrl: `/${id}`,
    supplyType: ProductSupplyType.external_source,
    isCuratedExternalCatalog: true,
    sourceAvailability: SourceCommercialAvailability.available,
    sourceSyncStatus: SourceSyncStatus.fresh,
    availabilityLastConfirmedAt: confirmedAt,
    sourceLastAttemptAt: null,
    createdAt: new Date('2025-01-01'),
    price: 4000,
    discountedPrice: 0,
  };
}

describe('CatalogRefreshExecutorService A5 Fix Pass #2', () => {
  it('dry-run does not commit cursor or revision', async () => {
    const checkpoint = createCheckpointStore(0, 0);
    const executor = new CatalogRefreshExecutorService(
      {
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getCount: jest.fn().mockResolvedValue(1),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          take: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([
            {
              id: 10,
              source: 'trendyol',
              sourceId: 'abc',
              sourceUrl: '/p-abc',
              supplyType: ProductSupplyType.external_source,
              isCuratedExternalCatalog: true,
              sourceAvailability: SourceCommercialAvailability.unknown,
              sourceSyncStatus: SourceSyncStatus.never_verified,
              availabilityLastConfirmedAt: null,
              sourceLastAttemptAt: null,
              createdAt: new Date('2025-01-01'),
              price: 100,
              discountedPrice: 0,
            },
          ]),
        })),
      } as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      { createOrReuseCatalogRefreshJob: jest.fn() } as any,
      mockCartRepo() as any,
      checkpoint.repo as any,
    );

    const report = await executor.execute({ mode: 'dry_run', maxItems: 10 });
    expect(report.cursorCommitted).toBe(false);
    expect(report.committedRevision).toBeNull();
    expect(checkpoint.get().afterProductId).toBe(0);
    expect(checkpoint.get().revision).toBe(0);
  });

  it('live-blocked does not mutate cursor/revision', async () => {
    const checkpoint = createCheckpointStore(50, 3);
    const executor = new CatalogRefreshExecutorService(
      {
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getCount: jest.fn().mockResolvedValue(0),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          take: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        })),
      } as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      { createOrReuseCatalogRefreshJob: jest.fn() } as any,
      mockCartRepo() as any,
      checkpoint.repo as any,
    );
    const report = await executor.execute({ mode: 'live', maxItems: 5 });
    expect(report.liveEnqueueBlockedReason).toContain(
      'CATALOG_REFRESH_LIVE_ENABLED',
    );
    expect(report.cursorCommitted).toBe(false);
    expect(checkpoint.get()).toEqual({
      afterProductId: 50,
      revision: 3,
      initialized: true,
    });
  });

  it('forward progression increments revision', async () => {
    const checkpoint = createCheckpointStore(0, 0);
    const prevLive = process.env.CATALOG_REFRESH_LIVE_ENABLED;
    process.env.CATALOG_REFRESH_LIVE_ENABLED = 'true';
    jest.resetModules();
    const { CatalogRefreshExecutorService: Fresh } = await import(
      './catalog-refresh-executor.service'
    );
    const ids = Array.from({ length: 200 }, (_, i) => i + 1);
    const executor = new Fresh(
      {
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getCount: jest.fn().mockResolvedValue(200),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          take: jest.fn().mockReturnThis(),
          getMany: jest
            .fn()
            .mockResolvedValue(
              ids.map((id) => freshAvailable(id, new Date())),
            ),
        })),
      } as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      { createOrReuseCatalogRefreshJob: jest.fn() } as any,
      mockCartRepo() as any,
      checkpoint.repo as any,
    );
    (executor as any).config = {
      ...(executor as any).config,
      liveEnqueueEnabled: true,
      backgroundPaused: false,
      maxCandidateWindow: 200,
      hardMaxItemsPerRun: 50,
      maxConcurrencyPerSource: 1,
    };
    const report = await executor.execute({ mode: 'live', maxItems: 25 });
    expect(report.cursorCommitted).toBe(true);
    expect(report.proposedNextAfterProductId).toBe(200);
    expect(checkpoint.get().afterProductId).toBe(200);
    expect(checkpoint.get().revision).toBe(1);
    expect(report.committedRevision).toBe(1);

    if (prevLive === undefined) delete process.env.CATALOG_REFRESH_LIVE_ENABLED;
    else process.env.CATALOG_REFRESH_LIVE_ENABLED = prevLive;
  });

  it('wrap increments revision', async () => {
    const checkpoint = createCheckpointStore(9000, 4);
    const executor = new CatalogRefreshExecutorService(
      {
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getCount: jest.fn().mockResolvedValue(0),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          take: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        })),
      } as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      { createOrReuseCatalogRefreshJob: jest.fn() } as any,
      mockCartRepo() as any,
      checkpoint.repo as any,
    );
    const result = await (executor as any).commitCheckpointForwardOnly(
      'global',
      9000,
      4,
      0,
    );
    expect(result.committed).toBe(true);
    expect(result.newRevision).toBe(5);
    expect(checkpoint.get().afterProductId).toBe(0);
    expect(checkpoint.get().revision).toBe(5);
  });

  it('ABA: stale writer with matching cursor but stale revision MUST fail', async () => {
    const checkpoint = createCheckpointStore(200, 12);
    const executor = new CatalogRefreshExecutorService(
      {
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getCount: jest.fn().mockResolvedValue(0),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          take: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        })),
      } as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      { createOrReuseCatalogRefreshJob: jest.fn() } as any,
      mockCartRepo() as any,
      checkpoint.repo as any,
    );

    // Obsolete A: read cursor=200 rev=10, propose wrap to 0
    const result = await (executor as any).commitCheckpointForwardOnly(
      'global',
      200,
      10,
      0,
    );
    expect(result.committed).toBe(false);
    expect(checkpoint.get().afterProductId).toBe(200);
    expect(checkpoint.get().revision).toBe(12);
  });

  it('stale unequal-cursor writer remains rejected', async () => {
    const checkpoint = createCheckpointStore(200, 5);
    const executor = new CatalogRefreshExecutorService(
      {
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getCount: jest.fn().mockResolvedValue(0),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          take: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        })),
      } as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      { createOrReuseCatalogRefreshJob: jest.fn() } as any,
      mockCartRepo() as any,
      checkpoint.repo as any,
    );
    const result = await (executor as any).commitCheckpointForwardOnly(
      'global',
      0,
      5,
      150,
    );
    expect(result.committed).toBe(false);
    expect(checkpoint.get().afterProductId).toBe(200);
  });

  it('duplicate initialization race is safe; unrelated DB error propagates', async () => {
    const dupRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockRejectedValue(
        Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY', errno: 1062 }),
      ),
      createQueryBuilder: jest.fn(),
    };
    const executor = new CatalogRefreshExecutorService(
      {
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getCount: jest.fn().mockResolvedValue(0),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          take: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        })),
      } as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      { createOrReuseCatalogRefreshJob: jest.fn() } as any,
      mockCartRepo() as any,
      dupRepo as any,
    );
    const dup = await (executor as any).commitCheckpointForwardOnly(
      'global',
      0,
      0,
      10,
    );
    expect(dup.committed).toBe(false);

    const boomRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockRejectedValue(
        Object.assign(new Error('connection lost'), {
          code: 'ECONNRESET',
        }),
      ),
      createQueryBuilder: jest.fn(),
    };
    const executor2 = new CatalogRefreshExecutorService(
      {
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getCount: jest.fn().mockResolvedValue(0),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          take: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        })),
      } as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      { createOrReuseCatalogRefreshJob: jest.fn() } as any,
      mockCartRepo() as any,
      boomRepo as any,
    );
    await expect(
      (executor2 as any).commitCheckpointForwardOnly('global', 0, 0, 10),
    ).rejects.toThrow(/connection lost/);
  });

  it('query-driven: afterProductId=0 loads 1-200; cycle2 with 200 exposes overdue 201', async () => {
    const prevLive = process.env.CATALOG_REFRESH_LIVE_ENABLED;
    process.env.CATALOG_REFRESH_LIVE_ENABLED = 'true';

    const now = new Date();
    const overdue = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
    const catalog = [
      ...Array.from({ length: 200 }, (_, i) =>
        freshAvailable(i + 1, now),
      ),
      freshAvailable(201, overdue),
    ];
    const checkpoint = createCheckpointStore(0, 0);

    jest.resetModules();
    const { CatalogRefreshExecutorService: Fresh } = await import(
      './catalog-refresh-executor.service'
    );

    let lastAfterId: number | null = null;
    const productRepository = {
      createQueryBuilder: jest.fn(() => {
        const params: Record<string, unknown> = {};
        const qb: any = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn(function (this: any, sql: string, p?: any) {
            if (p) Object.assign(params, p);
            return qb;
          }),
          getCount: jest.fn().mockResolvedValue(catalog.length),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          take: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockImplementation(async () => {
            const afterId = Number(params.afterId ?? 0);
            lastAfterId = afterId;
            return catalog
              .filter((p) => p.id > afterId)
              .slice(0, 200);
          }),
        };
        return qb;
      }),
    };

    const jobService = {
      createOrReuseCatalogRefreshJob: jest.fn().mockResolvedValue({
        kind: 'job',
        job: { jobId: 1 },
      }),
    };

    const executor = new Fresh(
      productRepository as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      jobService as any,
      mockCartRepo() as any,
      checkpoint.repo as any,
    );
    (executor as any).config = {
      ...(executor as any).config,
      liveEnqueueEnabled: true,
      backgroundPaused: false,
      maxCandidateWindow: 200,
      hardMaxItemsPerRun: 50,
      defaultBatchSize: 25,
      maxConcurrencyPerSource: 20,
    };

    const cycle1 = await executor.execute({ mode: 'live', maxItems: 25 });
    expect(lastAfterId).toBe(0);
    expect(cycle1.candidateWindowLoaded).toBe(200);
    expect(cycle1.proposedNextAfterProductId).toBe(200);
    expect(cycle1.cursorCommitted).toBe(true);
    expect(checkpoint.get().afterProductId).toBe(200);
    expect(checkpoint.get().revision).toBe(1);
    expect(cycle1.totals.eligible).toBe(0);

    const cycle2 = await executor.execute({ mode: 'live', maxItems: 25 });
    expect(lastAfterId).toBe(200);
    expect(cycle2.scanAfterProductId).toBe(200);
    expect(cycle2.totals.eligible).toBeGreaterThanOrEqual(1);
    expect(jobService.createOrReuseCatalogRefreshJob).toHaveBeenCalled();
    expect(checkpoint.get().revision).toBeGreaterThan(1);

    if (prevLive === undefined) delete process.env.CATALOG_REFRESH_LIVE_ENABLED;
    else process.env.CATALOG_REFRESH_LIVE_ENABLED = prevLive;
  });

  it('scopeKey fits max accepted source length', () => {
    const source = 's'.repeat(CATALOG_REFRESH_SOURCE_FILTER_MAX_LENGTH);
    const key = catalogRefreshCheckpointScopeKey(source);
    expect(key.length).toBeLessThanOrEqual(
      CATALOG_REFRESH_CHECKPOINT_SCOPE_KEY_MAX_LENGTH,
    );
    expect(key.startsWith('source:')).toBe(true);
  });

  it('11 scheduler does not load unbounded catalog', async () => {
    let takeArg: number | null = null;
    const executor = new CatalogRefreshExecutorService(
      {
        createQueryBuilder: jest.fn(() => {
          const qb: any = {
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            getCount: jest.fn().mockResolvedValue(0),
            select: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            take: jest.fn((n: number) => {
              takeArg = n;
              return qb;
            }),
            getMany: jest.fn().mockResolvedValue([]),
          };
          return qb;
        }),
      } as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      { createOrReuseCatalogRefreshJob: jest.fn() } as any,
      mockCartRepo() as any,
      createCheckpointStore(0, 0).repo as any,
    );
    await executor.execute({ mode: 'dry_run', maxItems: 50 });
    expect((takeArg as number) <= executor.getConfig().maxCandidateWindow).toBe(
      true,
    );
  });
});
