import { BadRequestException } from '@nestjs/common';
import { ShowcasePilotRefreshService } from './showcase-pilot-refresh.service';
import { SHOWCASE_PILOT_LIVE_ENABLED_ENV } from './showcase-pilot.constants';
import { ProductSupplyType } from './catalog-lifecycle.types';
import {
  SourceCommercialAvailability,
  SourceSyncStatus,
} from '../source-availability';
import {
  applyConfirmedCommercialSnapshot,
  applySourceSyncFailure,
  createInitialSourceAvailabilityProjection,
} from '../source-availability';
import { SourceSyncErrorCode } from '../source-availability';

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 97532,
    source: 'trendyol',
    sourceId: '111',
    sourceUrl: '/p-111',
    supplyType: ProductSupplyType.external_source,
    isCuratedExternalCatalog: true,
    sourceAvailability: SourceCommercialAvailability.unknown,
    sourceSyncStatus: SourceSyncStatus.never_verified,
    availabilityLastConfirmedAt: null,
    sourceLastAttemptAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    price: 100,
    discountedPrice: 0,
    isDeleted: false,
    ...overrides,
  };
}

describe('ShowcasePilotRefreshService', () => {
  const prevLive = process.env[SHOWCASE_PILOT_LIVE_ENABLED_ENV];

  afterEach(() => {
    if (prevLive === undefined) {
      delete process.env[SHOWCASE_PILOT_LIVE_ENABLED_ENV];
    } else {
      process.env[SHOWCASE_PILOT_LIVE_ENABLED_ENV] = prevLive;
    }
  });

  function createService(opts?: {
    products?: any[];
    activeJob?: any;
    createResult?: any;
    jobs?: any[];
  }) {
    const products = opts?.products ?? [productRow()];
    const productRepository = {
      find: jest.fn().mockResolvedValue(products),
    };
    const jobRepository = {
      createQueryBuilder: jest.fn(() => {
        const qb: any = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(opts?.jobs ?? []),
        };
        return qb;
      }),
    };
    const jobService = {
      findActiveJobByIdentity: jest
        .fn()
        .mockResolvedValue(opts?.activeJob ?? null),
      createOrReuseCatalogRefreshJob: jest
        .fn()
        .mockResolvedValue(
          opts?.createResult ?? {
            kind: 'job',
            job: { jobId: 9, accessToken: 'tok', status: 'queued' },
          },
        ),
    };
    const service = new ShowcasePilotRefreshService(
      productRepository as any,
      jobRepository as any,
      jobService as any,
    );
    return { service, productRepository, jobRepository, jobService };
  }

  it('rejects more than 40 product IDs', async () => {
    const { service } = createService();
    const ids = Array.from({ length: 41 }, (_, i) => i + 1);
    await expect(
      service.execute({ mode: 'dry_run', productIds: ids }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('dry-run selects eligible allowlisted products without enqueue', async () => {
    delete process.env[SHOWCASE_PILOT_LIVE_ENABLED_ENV];
    const { service, jobService } = createService({
      products: [
        productRow({ id: 1, sourceId: 'a' }),
        productRow({ id: 2, sourceId: 'b' }),
      ],
    });
    const report = await service.execute({
      mode: 'dry_run',
      productIds: [1, 2],
      includeJobOutcomes: false,
    });
    expect(report.mode).toBe('dry_run');
    expect(report.confirmation.dryRunPerformsNoEnqueue).toBe(true);
    expect(jobService.createOrReuseCatalogRefreshJob).not.toHaveBeenCalled();
    expect(jobService.findActiveJobByIdentity).not.toHaveBeenCalled();
    expect(report.counts.selected).toBe(1);
    expect(report.counts.skipped).toBe(1);
    expect(report.results.find((r) => r.outcome === 'skipped')?.reason).toBe(
      'per_source_concurrency',
    );
    expect(report.maxConcurrencyPerSource).toBe(1);
    expect(report.expectedExternalRequestsIfLive).toBe(1);
  });

  it('skips non-trendyol and missing products', async () => {
    const { service } = createService({
      products: [
        productRow({ id: 10, source: 'amazon', sourceId: 'x' }),
      ],
    });
    const report = await service.execute({
      mode: 'dry_run',
      productIds: [10, 999],
      includeJobOutcomes: false,
    });
    expect(report.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: 10,
          outcome: 'skipped',
          reason: 'source_not_trendyol',
        }),
        expect.objectContaining({
          productId: 999,
          outcome: 'skipped',
          reason: 'product_not_found',
        }),
      ]),
    );
  });

  it('live without SHOWCASE_PILOT_LIVE_ENABLED does not enqueue', async () => {
    delete process.env[SHOWCASE_PILOT_LIVE_ENABLED_ENV];
    const { service, jobService } = createService();
    const report = await service.execute({
      mode: 'live',
      productIds: [97532],
      includeJobOutcomes: false,
    });
    expect(report.liveEnqueueAttempted).toBe(true);
    expect(report.liveBlockedReason).toContain(SHOWCASE_PILOT_LIVE_ENABLED_ENV);
    expect(jobService.createOrReuseCatalogRefreshJob).not.toHaveBeenCalled();
    expect(report.counts.selected).toBe(1);
  });

  it('live with flag enqueues once and reuses active jobs (no duplicate)', async () => {
    process.env[SHOWCASE_PILOT_LIVE_ENABLED_ENV] = 'true';
    const { service, jobService } = createService({
      products: [productRow({ id: 1, sourceId: 'a' })],
      activeJob: { id: 55, status: 'processing' },
    });
    const report = await service.execute({
      mode: 'live',
      productIds: [1],
      includeJobOutcomes: false,
    });
    expect(report.counts.reused_active).toBe(1);
    expect(jobService.createOrReuseCatalogRefreshJob).not.toHaveBeenCalled();

    const { service: service2, jobService: jobService2 } = createService({
      products: [productRow({ id: 2, sourceId: 'b' })],
      activeJob: null,
      createResult: {
        kind: 'job',
        job: { jobId: 77, accessToken: 't', status: 'queued' },
      },
    });
    const report2 = await service2.execute({
      mode: 'live',
      productIds: [2],
      includeJobOutcomes: false,
    });
    expect(report2.counts.enqueued).toBe(1);
    expect(report2.results[0].jobId).toBe(77);
    expect(jobService2.createOrReuseCatalogRefreshJob).toHaveBeenCalledTimes(1);
  });

  it('resume surfaces prior succeeded/failed job outcomes without re-enqueue', async () => {
    delete process.env[SHOWCASE_PILOT_LIVE_ENABLED_ENV];
    const { service, jobService } = createService({
      products: [
        productRow({
          id: 1,
          sourceId: 'a',
          // Recently refreshed → not due; skipped by eligibility, then enriched
          sourceAvailability: SourceCommercialAvailability.available,
          sourceSyncStatus: SourceSyncStatus.fresh,
          availabilityLastConfirmedAt: new Date(),
        }),
      ],
      jobs: [
        {
          id: 88,
          source: 'trendyol',
          sourceProductId: 'a',
          status: 'succeeded',
          errorCode: null,
          errorMessage: null,
        },
      ],
    });
    const report = await service.execute({
      mode: 'dry_run',
      productIds: [1],
      includeJobOutcomes: true,
    });
    expect(jobService.createOrReuseCatalogRefreshJob).not.toHaveBeenCalled();
    expect(report.results[0].outcome).toBe('succeeded');
    expect(report.results[0].reason).toBe('prior_job_succeeded');
  });

  it('failed refresh projection does not invent freshness (price+stock gate)', () => {
    const t0 = new Date('2026-11-01T00:00:00Z');
    const t1 = new Date('2026-11-01T01:00:00Z');
    const available = applyConfirmedCommercialSnapshot(
      createInitialSourceAvailabilityProjection(),
      { outcome: 'available', observedAt: t0 },
    );
    const failed = applySourceSyncFailure(available, {
      errorCode: SourceSyncErrorCode.TIMEOUT,
      detail: 'timeout',
      attemptedAt: t1,
    });
    expect(failed.sourceSyncStatus).toBe(SourceSyncStatus.source_error);
    expect(failed.availabilityLastConfirmedAt).toEqual(t0);
    expect(failed.sourceAvailability).toBe(
      SourceCommercialAvailability.available,
    );
  });

  it('successful commercial snapshot marks fresh for price and availability together', () => {
    const t0 = new Date('2026-11-01T00:00:00Z');
    const next = applyConfirmedCommercialSnapshot(
      createInitialSourceAvailabilityProjection(),
      { outcome: 'available', observedAt: t0 },
    );
    expect(next.sourceSyncStatus).toBe(SourceSyncStatus.fresh);
    expect(next.sourceAvailability).toBe(
      SourceCommercialAvailability.available,
    );
    expect(next.availabilityLastConfirmedAt).toEqual(t0);
  });
});
