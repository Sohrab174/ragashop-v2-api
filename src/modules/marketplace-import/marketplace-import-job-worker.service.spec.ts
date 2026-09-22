import { MarketplaceImportJobWorkerService } from './marketplace-import-job-worker.service';
import { MarketplaceImportJobStatus } from './marketplace-import-job.types';
import { ProductSupplyType } from '../catalog-lifecycle/catalog-lifecycle.types';
import { membershipPatchForCustomerImportSuccess } from '../catalog-lifecycle/catalog-membership.util';
import { MarketplaceImportConcurrencyGate } from './marketplace-import-concurrency';
import {
  SourceCommercialAvailability,
  SourceSyncStatus,
} from '../source-availability';

describe('MarketplaceImportJobWorkerService paste-link P1', () => {
  const identityJob = {
    id: 11,
    source: 'trendyol',
    sourceProductId: '555',
    canonicalSourceUrl: 'https://www.trendyol.com/brand/x-p-555',
    requestType: 'customer',
    status: MarketplaceImportJobStatus.processing,
  };

  function createWorker(overrides: {
    existingProduct?: Record<string, unknown> | null;
    removedTombstone?: Record<string, unknown> | null;
    crawlerResult?: { id: number; name: string };
    crawlerError?: unknown;
  }) {
    const jobService = {
      getProcessingJob: jest.fn().mockResolvedValue(identityJob),
      reconcileSucceededProduct: jest.fn().mockResolvedValue(true),
      markJobSucceeded: jest.fn().mockResolvedValue(true),
      markJobFailed: jest.fn().mockResolvedValue(true),
      classifyFailure: jest.fn().mockReturnValue({
        kind: 'retryable',
        errorCode: 'CRAWLER_UNAVAILABLE',
        errorMessage: 'busy',
      }),
    };
    const crawlerClient = {
      importProduct: overrides.crawlerError
        ? jest.fn().mockRejectedValue(overrides.crawlerError)
        : jest
            .fn()
            .mockResolvedValue(
              overrides.crawlerResult || { id: 9, name: 'New' },
            ),
    };
    const concurrencyGate = {
      acquire: jest.fn().mockResolvedValue({ release: jest.fn() }),
      getMaxConcurrent: jest.fn().mockReturnValue(3),
    };
    const query = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest
        .fn()
        .mockResolvedValueOnce(overrides.existingProduct ?? null)
        .mockResolvedValue(overrides.removedTombstone ?? null),
    };
    const productRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const worker = new MarketplaceImportJobWorkerService(
      jobService as any,
      crawlerClient as any,
      concurrencyGate as any,
      productRepository as any,
    );

    return { worker, jobService, crawlerClient, productRepository };
  }

  it('reuses existing healthy fresh product without calling crawler', async () => {
    const { worker, crawlerClient, jobService } = createWorker({
      existingProduct: {
        id: 4,
        name: 'Existing',
        supplyType: ProductSupplyType.external_source,
        sourceAvailability: SourceCommercialAvailability.available,
        sourceSyncStatus: SourceSyncStatus.fresh,
        availabilityLastConfirmedAt: new Date(),
      },
    });

    await worker.processClaimedJob(11, 'claim');

    expect(crawlerClient.importProduct).not.toHaveBeenCalled();
    expect(jobService.reconcileSucceededProduct).toHaveBeenCalledWith(
      11,
      'claim',
      4,
    );
    expect(jobService.markJobSucceeded).not.toHaveBeenCalled();
  });

  it('28 scheduled catalog refresh forces crawl even when high-intent would skip', async () => {
    const jobService = {
      getProcessingJob: jest.fn().mockResolvedValue({
        ...identityJob,
        requestType: 'scheduled',
      }),
      reconcileSucceededProduct: jest.fn().mockResolvedValue(true),
      markJobSucceeded: jest.fn().mockResolvedValue(true),
      markJobFailed: jest.fn().mockResolvedValue(true),
      classifyFailure: jest.fn().mockReturnValue({
        kind: 'retryable',
        errorCode: 'CRAWLER_UNAVAILABLE',
        errorMessage: 'busy',
      }),
    };
    const crawlerClient = {
      importProduct: jest.fn().mockResolvedValue({ id: 4, name: 'Refreshed' }),
    };
    const concurrencyGate = {
      acquire: jest.fn().mockResolvedValue({ release: jest.fn() }),
      getMaxConcurrent: jest.fn().mockReturnValue(3),
    };
    const query = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 4,
        name: 'Existing',
        supplyType: ProductSupplyType.external_source,
        sourceAvailability: SourceCommercialAvailability.available,
        sourceSyncStatus: SourceSyncStatus.fresh,
        availabilityLastConfirmedAt: new Date(),
      }),
    };
    const productRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const worker = new MarketplaceImportJobWorkerService(
      jobService as any,
      crawlerClient as any,
      concurrencyGate as any,
      productRepository as any,
    );

    await worker.processClaimedJob(11, 'claim');

    expect(crawlerClient.importProduct).toHaveBeenCalled();
    expect(jobService.reconcileSucceededProduct).not.toHaveBeenCalled();
    expect(jobService.markJobSucceeded).toHaveBeenCalledWith(11, 'claim', 4);
  });

  it('crawls existing STALE product instead of reconciling stale data', async () => {
    const { worker, crawlerClient, jobService } = createWorker({
      existingProduct: {
        id: 4,
        name: 'Stale',
        supplyType: ProductSupplyType.external_source,
        sourceAvailability: SourceCommercialAvailability.available,
        sourceSyncStatus: SourceSyncStatus.stale,
        availabilityLastConfirmedAt: new Date('2020-01-01T00:00:00.000Z'),
      },
      crawlerResult: { id: 4, name: 'Refreshed' },
    });

    await worker.processClaimedJob(11, 'claim');

    expect(crawlerClient.importProduct).toHaveBeenCalled();
    expect(jobService.reconcileSucceededProduct).not.toHaveBeenCalled();
    expect(jobService.markJobSucceeded).toHaveBeenCalledWith(11, 'claim', 4);
  });

  it('preserves product id after high-intent refresh success', async () => {
    const { worker, jobService } = createWorker({
      existingProduct: {
        id: 88,
        name: 'Curated',
        supplyType: ProductSupplyType.external_source,
        sourceAvailability: SourceCommercialAvailability.unknown,
        sourceSyncStatus: SourceSyncStatus.never_verified,
        availabilityLastConfirmedAt: null,
      },
      crawlerResult: { id: 88, name: 'Curated refreshed' },
    });

    await worker.processClaimedJob(11, 'claim');
    expect(jobService.markJobSucceeded).toHaveBeenCalledWith(11, 'claim', 88);
  });

  it('applies external supply without demoting curated membership after new import', async () => {
    const { worker, productRepository, crawlerClient } = createWorker({
      existingProduct: null,
      crawlerResult: { id: 88, name: 'Imported' },
    });

    await worker.processClaimedJob(11, 'claim');

    expect(crawlerClient.importProduct).toHaveBeenCalled();
    expect(crawlerClient.importProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceProductId: '555',
        sourceUrl: '/p/product-p-555',
        canonicalUrl: 'https://www.trendyol.com/p/product-p-555',
      }),
    );
    expect(productRepository.update).toHaveBeenCalledWith(
      { id: 88 },
      membershipPatchForCustomerImportSuccess(),
    );
    const patch = productRepository.update.mock.calls[0][1];
    expect(patch.supplyType).toBe(ProductSupplyType.external_source);
    expect(patch).not.toHaveProperty('isCuratedExternalCatalog');
  });

  it('refresh of existing curated product applies supply patch without demoting curated', async () => {
    const { worker, productRepository } = createWorker({
      existingProduct: {
        id: 88,
        name: 'Curated',
        supplyType: ProductSupplyType.external_source,
        sourceAvailability: SourceCommercialAvailability.unavailable,
        sourceSyncStatus: SourceSyncStatus.fresh,
        availabilityLastConfirmedAt: new Date(),
      },
      crawlerResult: { id: 88, name: 'Curated' },
    });

    await worker.processClaimedJob(11, 'claim');

    const patch = productRepository.update.mock.calls[0][1];
    expect(patch.supplyType).toBe(ProductSupplyType.external_source);
    expect(patch).not.toHaveProperty('isCuratedExternalCatalog');
  });

  it('temporary crawler failure is classified retryable and does not succeed the job', async () => {
    const { worker, jobService } = createWorker({
      existingProduct: null,
      crawlerError: { code: 'ECONNABORTED' },
    });

    await worker.processClaimedJob(11, 'claim');

    expect(jobService.markJobSucceeded).not.toHaveBeenCalled();
    expect(jobService.markJobFailed).toHaveBeenCalledWith(
      11,
      'claim',
      'CRAWLER_UNAVAILABLE',
      'busy',
      true,
    );
  });

  it('transient refresh failure of an existing product does not succeed the job', async () => {
    const { worker, jobService, productRepository } = createWorker({
      existingProduct: {
        id: 4,
        name: 'Stale',
        supplyType: ProductSupplyType.external_source,
        sourceAvailability: SourceCommercialAvailability.available,
        sourceSyncStatus: SourceSyncStatus.source_error,
        availabilityLastConfirmedAt: new Date(),
      },
      crawlerError: { code: 'ECONNABORTED' },
    });

    await worker.processClaimedJob(11, 'claim');

    expect(jobService.markJobSucceeded).not.toHaveBeenCalled();
    expect(jobService.markJobFailed).toHaveBeenCalledWith(
      11,
      'claim',
      'CRAWLER_UNAVAILABLE',
      'busy',
      true,
    );
    expect(productRepository.update).not.toHaveBeenCalled();
  });

  it('does not recrawl a REMOVED/deleted tombstone on worker retry', async () => {
    const { worker, crawlerClient, jobService } = createWorker({
      existingProduct: null,
      removedTombstone: { id: 9, name: 'Gone' },
    });

    await worker.processClaimedJob(11, 'claim');

    expect(crawlerClient.importProduct).not.toHaveBeenCalled();
    expect(jobService.markJobSucceeded).not.toHaveBeenCalled();
    expect(jobService.markJobFailed).toHaveBeenCalledWith(
      11,
      'claim',
      'SOURCE_UNAVAILABLE',
      'محصولی یافت نشد!',
      false,
    );
  });

  it('still crawls ordinary deleted non-REMOVED identities', async () => {
    const { worker, crawlerClient, jobService } = createWorker({
      existingProduct: null,
      removedTombstone: null,
      crawlerResult: { id: 12, name: 'New' },
    });

    await worker.processClaimedJob(11, 'claim');

    expect(crawlerClient.importProduct).toHaveBeenCalled();
    expect(jobService.markJobSucceeded).toHaveBeenCalledWith(11, 'claim', 12);
  });
});

describe('MarketplaceImportJobWorkerService scheduling', () => {
  function createSchedulingWorker(maxConcurrent: number) {
    let active = 0;
    let maxObserved = 0;

    const jobService = {
      recoverExpiredClaims: jest.fn().mockResolvedValue(undefined),
      claimNextEligibleJob: jest
        .fn()
        .mockResolvedValueOnce({ job: { id: 1 }, claimToken: 'a' })
        .mockResolvedValueOnce({ job: { id: 2 }, claimToken: 'b' })
        .mockResolvedValueOnce({ job: { id: 3 }, claimToken: 'c' })
        .mockResolvedValueOnce({ job: { id: 4 }, claimToken: 'd' })
        .mockResolvedValue(null),
      getProcessingJob: jest.fn().mockImplementation(async (jobId: number) => ({
        id: jobId,
        source: 'trendyol',
        sourceProductId: String(jobId),
        canonicalSourceUrl: `https://www.trendyol.com/brand/x-p-${jobId}`,
        requestType: 'customer',
        status: MarketplaceImportJobStatus.processing,
      })),
      markJobSucceeded: jest.fn().mockResolvedValue(true),
      markJobFailed: jest.fn().mockResolvedValue(true),
      classifyFailure: jest.fn(),
      reconcileSucceededProduct: jest.fn(),
    };

    const crawlerClient = {
      importProduct: jest.fn().mockImplementation(async () => {
        active += 1;
        maxObserved = Math.max(maxObserved, active);
        await new Promise((r) => setTimeout(r, 40));
        active -= 1;
        return { id: 100 + maxObserved, name: 'P' };
      }),
    };

    const gate = new MarketplaceImportConcurrencyGate({
      maxConcurrent,
      maxQueue: 20,
      queueTimeoutMs: 5000,
    });

    const query = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    const productRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const worker = new MarketplaceImportJobWorkerService(
      jobService as any,
      crawlerClient as any,
      gate,
      productRepository as any,
    );

    return {
      worker,
      crawlerClient,
      getMaxObserved: () => maxObserved,
    };
  }

  it('overlaps jobs up to configured capacity and never exceeds it', async () => {
    const { worker, crawlerClient, getMaxObserved } = createSchedulingWorker(3);

    await worker.tick();

    expect(crawlerClient.importProduct).toHaveBeenCalledTimes(4);
    expect(getMaxObserved()).toBeGreaterThan(1);
    expect(getMaxObserved()).toBeLessThanOrEqual(3);
  });

  it('stays serial when capacity is 1', async () => {
    const { worker, crawlerClient, getMaxObserved } = createSchedulingWorker(1);

    await worker.tick();

    expect(crawlerClient.importProduct).toHaveBeenCalledTimes(4);
    expect(getMaxObserved()).toBe(1);
  });

  it('delayed claim after shutdown does not process and releases ownership', async () => {
    let resolveClaim: (value: any) => void = () => undefined;
    const releaseClaimForShutdown = jest.fn().mockResolvedValue(true);
    const processSpyEvents: string[] = [];

    const jobService = {
      recoverExpiredClaims: jest.fn().mockResolvedValue(undefined),
      claimNextEligibleJob: jest.fn(
        () =>
          new Promise((resolve) => {
            resolveClaim = resolve;
          }),
      ),
      releaseClaimForShutdown,
      getProcessingJob: jest.fn().mockImplementation(async () => {
        processSpyEvents.push('getProcessingJob');
        return null;
      }),
      markJobSucceeded: jest.fn(),
      markJobFailed: jest.fn(),
      classifyFailure: jest.fn(),
      reconcileSucceededProduct: jest.fn(),
    };

    const crawlerClient = {
      importProduct: jest.fn().mockImplementation(async () => {
        processSpyEvents.push('importProduct');
        return { id: 1, name: 'x' };
      }),
    };

    const gate = new MarketplaceImportConcurrencyGate({
      maxConcurrent: 2,
      maxQueue: 10,
      queueTimeoutMs: 5000,
    });

    const query = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    const productRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
      update: jest.fn(),
    };

    const worker = new MarketplaceImportJobWorkerService(
      jobService as any,
      crawlerClient as any,
      gate,
      productRepository as any,
    );

    const tickPromise = worker.tick();
    await new Promise((r) => setImmediate(r));

    const destroyPromise = worker.onModuleDestroy();
    resolveClaim({ job: { id: 77 }, claimToken: 'claim-77' });

    await Promise.all([tickPromise, destroyPromise]);

    expect(releaseClaimForShutdown).toHaveBeenCalledWith(77, 'claim-77');
    expect(processSpyEvents).not.toContain('importProduct');
    expect(crawlerClient.importProduct).not.toHaveBeenCalled();
  });

  it('destroy stays pending until delayed releaseClaimForShutdown finishes', async () => {
    let resolveClaim: (value: any) => void = () => undefined;
    let resolveRelease: (value: any) => void = () => undefined;
    const releaseClaimForShutdown = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveRelease = resolve;
        }),
    );

    const jobService = {
      recoverExpiredClaims: jest.fn().mockResolvedValue(undefined),
      claimNextEligibleJob: jest.fn(
        () =>
          new Promise((resolve) => {
            resolveClaim = resolve;
          }),
      ),
      releaseClaimForShutdown,
      getProcessingJob: jest.fn(),
      markJobSucceeded: jest.fn(),
      markJobFailed: jest.fn(),
      classifyFailure: jest.fn(),
      reconcileSucceededProduct: jest.fn(),
    };

    const crawlerClient = {
      importProduct: jest.fn(),
    };

    const gate = new MarketplaceImportConcurrencyGate({
      maxConcurrent: 2,
      maxQueue: 10,
      queueTimeoutMs: 5000,
    });

    const query = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    const productRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
      update: jest.fn(),
    };

    const worker = new MarketplaceImportJobWorkerService(
      jobService as any,
      crawlerClient as any,
      gate,
      productRepository as any,
    );

    const tickPromise = worker.tick();
    await new Promise((r) => setImmediate(r));

    let destroySettled = false;
    const destroyPromise = worker.onModuleDestroy().then(() => {
      destroySettled = true;
    });

    resolveClaim({ job: { id: 88 }, claimToken: 'claim-88' });
    await new Promise((r) => setTimeout(r, 40));

    expect(releaseClaimForShutdown).toHaveBeenCalledWith(88, 'claim-88');
    expect(destroySettled).toBe(false);

    resolveRelease(true);
    await Promise.all([tickPromise, destroyPromise]);

    expect(destroySettled).toBe(true);
    expect(crawlerClient.importProduct).not.toHaveBeenCalled();
  });
});
