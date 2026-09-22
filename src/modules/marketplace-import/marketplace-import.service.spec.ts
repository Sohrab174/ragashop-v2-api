import { HttpException, HttpStatus } from '@nestjs/common';
import { ProductSupplyType } from '../catalog-lifecycle/catalog-lifecycle.types';
import {
  SourceCommercialAvailability,
  SourceSyncStatus,
} from '../source-availability';
import { ProductStatus } from '../product/entities/product.entity';
import { MarketplaceImportCoalescer } from './marketplace-import-coalescer';
import { MarketplaceImportService } from './marketplace-import.service';
import { MarketplaceImportJobStatus } from './marketplace-import-job.types';
import { membershipPatchForCustomerImportSuccess } from '../catalog-lifecycle/catalog-membership.util';

describe('MarketplaceImportService A6 high-intent refresh', () => {
  const identity = {
    marketplace: 'trendyol' as const,
    sourceProductId: '123',
    canonicalUrl: 'https://www.trendyol.com/brand/x-p-123',
    sourceUrl: '/brand/x-p-123',
  };

  const queuedJob = {
    kind: 'job' as const,
    job: {
      jobId: 42,
      accessToken: 'token',
      status: MarketplaceImportJobStatus.queued,
    },
  };

  let service: MarketplaceImportService;
  let productRepository: any;
  let redirectResolver: any;
  let rateLimiter: any;
  let coalescer: any;
  let jobService: any;

  beforeEach(() => {
    productRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
    };
    redirectResolver = { resolveTyGlToIdentity: jest.fn() };
    rateLimiter = { isAllowed: jest.fn().mockReturnValue(true) };
    coalescer = {
      coalesce: jest.fn((_key, fn) => fn()),
    };
    jobService = {
      createOrReuseCustomerJob: jest.fn().mockResolvedValue(queuedJob),
      getPublicJobStatus: jest.fn(),
    };

    service = new MarketplaceImportService(
      productRepository,
      redirectResolver,
      rateLimiter,
      coalescer,
      jobService,
    );
  });

  function healthyExisting(overrides: Record<string, unknown> = {}) {
    return {
      id: 5,
      name: 'Existing',
      supplyType: ProductSupplyType.external_source,
      sourceAvailability: SourceCommercialAvailability.available,
      sourceSyncStatus: SourceSyncStatus.fresh,
      availabilityLastConfirmedAt: new Date(),
      status: ProductStatus.active,
      isDeleted: false,
      ...overrides,
    };
  }

  function mockQueryChain(result: any) {
    const chain = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(result),
    };
    productRepository.createQueryBuilder.mockReturnValue(chain);
    return chain;
  }

  function mockLookupSequence(results: any[]) {
    const chain = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };
    results.forEach((row) => chain.getOne.mockResolvedValueOnce(row));
    chain.getOne.mockResolvedValue(null);
    productRepository.createQueryBuilder.mockReturnValue(chain);
    return chain;
  }

  it('returns existing healthy fresh product without creating a job', async () => {
    mockQueryChain(healthyExisting());

    const result = await service.importFromUrl(
      identity.canonicalUrl,
      '1.1.1.1',
    );

    expect(result).toEqual({ kind: 'product', id: 5, name: 'Existing' });
    expect(jobService.createOrReuseCustomerJob).not.toHaveBeenCalled();
    expect(coalescer.coalesce).not.toHaveBeenCalled();
  });

  it('enqueues USER_IMPORT refresh for STALE existing product', async () => {
    mockQueryChain(
      healthyExisting({ sourceSyncStatus: SourceSyncStatus.stale }),
    );

    const result = await service.importFromUrl(
      identity.canonicalUrl,
      '1.1.1.1',
    );

    expect(result).toEqual(queuedJob);
    expect(jobService.createOrReuseCustomerJob).toHaveBeenCalledTimes(1);
    expect(coalescer.coalesce).toHaveBeenCalledWith(
      'trendyol:123',
      expect.any(Function),
    );
  });

  it('enqueues refresh for NEVER_VERIFIED existing product', async () => {
    mockQueryChain(
      healthyExisting({
        sourceSyncStatus: SourceSyncStatus.never_verified,
        availabilityLastConfirmedAt: null,
      }),
    );

    await service.importFromUrl(identity.canonicalUrl, '1.1.1.1');
    expect(jobService.createOrReuseCustomerJob).toHaveBeenCalled();
  });

  it('enqueues refresh for SOURCE_ERROR existing product', async () => {
    mockQueryChain(
      healthyExisting({ sourceSyncStatus: SourceSyncStatus.source_error }),
    );

    await service.importFromUrl(identity.canonicalUrl, '1.1.1.1');
    expect(jobService.createOrReuseCustomerJob).toHaveBeenCalled();
  });

  it('enqueues refresh for UNKNOWN availability existing product', async () => {
    mockQueryChain(
      healthyExisting({
        sourceAvailability: SourceCommercialAvailability.unknown,
      }),
    );

    await service.importFromUrl(identity.canonicalUrl, '1.1.1.1');
    expect(jobService.createOrReuseCustomerJob).toHaveBeenCalled();
  });

  it('enqueues refresh for UNAVAILABLE existing product', async () => {
    mockQueryChain(
      healthyExisting({
        sourceAvailability: SourceCommercialAvailability.unavailable,
      }),
    );

    await service.importFromUrl(identity.canonicalUrl, '1.1.1.1');
    expect(jobService.createOrReuseCustomerJob).toHaveBeenCalled();
  });

  it('does not enqueue refresh for REMOVED existing active product', async () => {
    mockQueryChain(
      healthyExisting({
        sourceAvailability: SourceCommercialAvailability.removed,
      }),
    );

    const result = await service.importFromUrl(
      identity.canonicalUrl,
      '1.1.1.1',
    );

    expect(result).toEqual({ kind: 'product', id: 5, name: 'Existing' });
    expect(jobService.createOrReuseCustomerJob).not.toHaveBeenCalled();
  });

  it('does not recrawl deleted REMOVED identity (no hammering as new import)', async () => {
    mockLookupSequence([
      null,
      null,
      healthyExisting({
        id: 9,
        name: 'Gone',
        sourceAvailability: SourceCommercialAvailability.removed,
        isDeleted: true,
        status: ProductStatus.inactive,
      }),
    ]);

    await expect(
      service.importFromUrl(identity.canonicalUrl, '1.1.1.1'),
    ).rejects.toMatchObject({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      response: { data: { code: 'PRODUCT_NOT_FOUND' } },
    });
    expect(jobService.createOrReuseCustomerJob).not.toHaveBeenCalled();
  });

  it('enqueues refresh when confirmation is older than TTL', async () => {
    mockQueryChain(
      healthyExisting({
        availabilityLastConfirmedAt: new Date('2020-01-01T00:00:00.000Z'),
      }),
    );

    await service.importFromUrl(identity.canonicalUrl, '1.1.1.1');
    expect(jobService.createOrReuseCustomerJob).toHaveBeenCalled();
  });

  it('keeps fast path when confirmation is within TTL', async () => {
    mockQueryChain(
      healthyExisting({ availabilityLastConfirmedAt: new Date() }),
    );

    const result = await service.importFromUrl(
      identity.canonicalUrl,
      '1.1.1.1',
    );
    expect(result.kind).toBe('product');
    expect(jobService.createOrReuseCustomerJob).not.toHaveBeenCalled();
  });

  it('coalesces concurrent Paste-a-Link refresh for the same stale product', async () => {
    const realCoalescer = new MarketplaceImportCoalescer();
    coalescer.coalesce.mockImplementation((key, fn) =>
      realCoalescer.coalesce(key, fn),
    );
    mockQueryChain(
      healthyExisting({ sourceSyncStatus: SourceSyncStatus.stale }),
    );
    jobService.createOrReuseCustomerJob.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(queuedJob), 30);
        }),
    );

    const [first, second] = await Promise.all([
      service.importFromUrl(identity.canonicalUrl, '1.1.1.1'),
      service.importFromUrl(`${identity.canonicalUrl}?utm=2`, '1.1.1.1'),
    ]);

    expect(first).toEqual(second);
    expect(jobService.createOrReuseCustomerJob).toHaveBeenCalledTimes(1);
  });

  it('does not demote curated membership on customer refresh patch', () => {
    const before = {
      supplyType: ProductSupplyType.external_source,
      isCuratedExternalCatalog: true,
    };
    const after = { ...before, ...membershipPatchForCustomerImportSuccess() };
    expect(after.isCuratedExternalCatalog).toBe(true);
    expect(membershipPatchForCustomerImportSuccess()).not.toHaveProperty(
      'isCuratedExternalCatalog',
    );
  });

  it('does not recrawl native marketplace products', async () => {
    mockQueryChain(
      healthyExisting({
        supplyType: ProductSupplyType.native_marketplace,
        sourceSyncStatus: SourceSyncStatus.stale,
      }),
    );

    const result = await service.importFromUrl(
      identity.canonicalUrl,
      '1.1.1.1',
    );
    expect(result.kind).toBe('product');
    expect(jobService.createOrReuseCustomerJob).not.toHaveBeenCalled();
  });

  it('maps spoofed trendyol host to customer-safe UNSUPPORTED_SOURCE', async () => {
    await expect(
      service.importFromUrl(
        'https://trendyol.com.attacker.com/brand/x-p-123',
        '1.1.1.1',
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      response: {
        data: { code: 'UNSUPPORTED_SOURCE' },
      },
    });
    expect(jobService.createOrReuseCustomerJob).not.toHaveBeenCalled();
  });

  it('rejects malformed and non-http input without job creation', async () => {
    await expect(
      service.importFromUrl('not a url', '1.1.1.1'),
    ).rejects.toBeInstanceOf(HttpException);
    await expect(
      service.importFromUrl('ftp://www.trendyol.com/brand/x-p-123', '1.1.1.1'),
    ).rejects.toBeInstanceOf(HttpException);
    expect(jobService.createOrReuseCustomerJob).not.toHaveBeenCalled();
  });

  it('rejects unsupported Amazon URL without job creation', async () => {
    await expect(
      service.importFromUrl('https://www.amazon.com/dp/B00TEST', '1.1.1.1'),
    ).rejects.toMatchObject({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      response: { data: { code: 'UNSUPPORTED_SOURCE' } },
    });
    expect(jobService.createOrReuseCustomerJob).not.toHaveBeenCalled();
  });

  it('rejects unsupported Beymen URL without job creation', async () => {
    await expect(
      service.importFromUrl('https://www.beymen.com/p-1', '1.1.1.1'),
    ).rejects.toMatchObject({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      response: { data: { code: 'UNSUPPORTED_SOURCE' } },
    });
    expect(jobService.createOrReuseCustomerJob).not.toHaveBeenCalled();
  });

  it('reuses the same job on repeated submission for a new product', async () => {
    mockQueryChain(null);

    const first = await service.importFromUrl(identity.canonicalUrl, '1.1.1.1');
    const second = await service.importFromUrl(
      `${identity.canonicalUrl}?utm=2`,
      '1.1.1.1',
    );

    expect(first).toEqual(second);
    expect(jobService.createOrReuseCustomerJob).toHaveBeenCalledTimes(2);
  });

  it('returns 429 when rate limited', async () => {
    rateLimiter.isAllowed.mockReturnValue(false);

    await expect(
      service.importFromUrl(identity.canonicalUrl, '1.1.1.1'),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it('rejects invalid URL without job creation', async () => {
    await expect(
      service.importFromUrl('https://evil.com/p-p-1', '1.1.1.1'),
    ).rejects.toBeInstanceOf(HttpException);

    expect(jobService.createOrReuseCustomerJob).not.toHaveBeenCalled();
    expect(productRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('creates durable job for new product', async () => {
    mockQueryChain(null);

    const result = await service.importFromUrl(
      identity.canonicalUrl,
      '1.1.1.1',
    );

    expect(result).toEqual(queuedJob);
    expect(jobService.createOrReuseCustomerJob).toHaveBeenCalled();
  });

  it('reuses active job via coalescer key for new product', async () => {
    mockQueryChain(null);

    await service.importFromUrl(identity.canonicalUrl, '1.1.1.1');
    expect(coalescer.coalesce).toHaveBeenCalledWith(
      'trendyol:123',
      expect.any(Function),
    );
  });

  it('does not treat a still-stale existing product as a completed job', async () => {
    mockQueryChain(
      healthyExisting({ sourceSyncStatus: SourceSyncStatus.stale }),
    );

    const result = await service.importFromUrl(
      identity.canonicalUrl,
      '1.1.1.1',
    );

    expect(result.kind).toBe('job');
    expect(result).toEqual(queuedJob);
  });
});
