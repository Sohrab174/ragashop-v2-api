import { createConnection, Connection, Repository } from 'typeorm';
import { MarketplaceImportJobEntity } from '../src/modules/marketplace-import/entities/marketplace-import-job.entity';
import { MarketplaceImportJobService } from '../src/modules/marketplace-import/marketplace-import-job.service';
import {
  MarketplaceImportJobStatus,
  MarketplaceImportRequestType,
} from '../src/modules/marketplace-import/marketplace-import-job.types';
import { dateTime } from '../src/utils';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ormconfig = require('../ormconfig.json');

const LOCAL_HOST = '127.0.0.1';
const LOCAL_DB = 'ragashop_local';

describe('Marketplace import job concurrency (LOCAL DB)', () => {
  let connection: Connection;
  let dbAvailable = false;
  let skipReason = '';
  let jobService: MarketplaceImportJobService;
  let jobRepository: Repository<MarketplaceImportJobEntity>;
  const createdJobIds: number[] = [];

  beforeAll(async () => {
    if (ormconfig.host !== LOCAL_HOST || ormconfig.database !== LOCAL_DB) {
      skipReason = `Expected ${LOCAL_HOST}/${LOCAL_DB}`;
      return;
    }

    try {
      connection = await createConnection({
        ...ormconfig,
        entities: [`${__dirname}/../src/**/*.entity{.ts,.js}`],
      });
      dbAvailable = true;
      jobRepository = connection.getRepository(MarketplaceImportJobEntity);
      jobService = new MarketplaceImportJobService(jobRepository, connection);
    } catch (err) {
      skipReason = err?.message || 'connection failed';
    }
  }, 120000);

  afterAll(async () => {
    if (connection?.isConnected) {
      if (createdJobIds.length) {
        await connection.query(
          `DELETE FROM marketplace_import_job WHERE id IN (${createdJobIds.join(
            ',',
          )})`,
        );
      }
      await connection.close();
    }
  });

  function requireDb() {
    if (!dbAvailable) {
      throw new Error(`LOCAL DB unavailable: ${skipReason}`);
    }
  }

  async function createQueuedJob(suffix: string) {
    const now = new Date(dateTime());
    const job = jobRepository.create({
      source: 'trendyol',
      sourceProductId: `test-${suffix}-${Date.now()}`,
      canonicalSourceUrl: `https://www.trendyol.com/brand/x-p-${suffix}`,
      requestType: MarketplaceImportRequestType.customer,
      status: MarketplaceImportJobStatus.queued,
      attemptCount: 0,
      maxAttempts: 3,
      activeDedupKey: `trendyol:test-${suffix}-${Date.now()}`,
      publicAccessToken: `token-${suffix}-${Date.now()}`,
      createdAt: now,
      updatedAt: now,
    });
    const saved = await jobRepository.save(job);
    createdJobIds.push(saved.id);
    return saved;
  }

  it('prevents duplicate active jobs for same source product', async () => {
    requireDb();
    const identity = {
      source: 'trendyol',
      sourceProductId: `dedup-${Date.now()}`,
      canonicalUrl: 'https://www.trendyol.com/brand/x-p-dedup',
      sourceUrl: '/brand/x-p-dedup',
    };

    const [first, second] = await Promise.all([
      jobService.createOrReuseCustomerJob(identity, null, null),
      jobService.createOrReuseCustomerJob(identity, null, null),
    ]);

    expect(first?.kind).toBe('job');
    expect(second?.kind).toBe('job');
    expect(
      first?.kind === 'job' && second?.kind === 'job'
        ? first.job.jobId === second.job.jobId
        : false,
    ).toBe(true);

    if (first?.kind === 'job') {
      createdJobIds.push(first.job.jobId);
    }
  });

  it('allows only one worker to claim the same fixture job', async () => {
    requireDb();
    const job = await createQueuedJob('claim');

    const [claimA, claimB] = await Promise.all([
      jobService.claimEligibleJobById(job.id),
      jobService.claimEligibleJobById(job.id),
    ]);

    const winners = [claimA, claimB].filter(
      (claim) => claim?.job.id === job.id && !!claim?.claimToken,
    );

    expect(winners).toHaveLength(1);
    expect(claimA?.job.id === job.id ? 1 : 0).toBeLessThanOrEqual(1);
    expect(claimB?.job.id === job.id ? 1 : 0).toBeLessThanOrEqual(1);
  });

  it('recovers expired lease and allows reclaim', async () => {
    requireDb();
    const job = await createQueuedJob('lease');
    const claimed = await jobService.claimEligibleJobById(job.id);
    expect(claimed?.job.id).toBe(job.id);

    await connection.query(
      `UPDATE marketplace_import_job SET claimExpiresAt = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?`,
      [job.id],
    );

    const recoveredCount = await jobService.recoverExpiredClaims();
    expect(recoveredCount).toBeGreaterThanOrEqual(1);

    const reloaded = await jobRepository.findOne({ where: { id: job.id } });
    expect(reloaded?.status).toBe(MarketplaceImportJobStatus.retry_wait);
    expect(reloaded?.claimToken).toBeNull();
  });

  it('rejects stale claim token on completion', async () => {
    requireDb();
    const job = await createQueuedJob('stale-complete');
    const claimed = await jobService.claimEligibleJobById(job.id);
    expect(claimed?.job.id).toBe(job.id);

    const staleSucceeded = await jobService.markJobSucceeded(
      job.id,
      'stale-token',
      123,
    );
    expect(staleSucceeded).toBe(false);

    const validSucceeded = await jobService.markJobSucceeded(
      job.id,
      claimed!.claimToken,
      123,
    );
    expect(validSucceeded).toBe(true);
  });
});
