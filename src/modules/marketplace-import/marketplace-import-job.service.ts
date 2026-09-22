import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { Brackets, Connection, In, Repository } from 'typeorm';
import { dateTime } from '../../utils';
import { MarketplaceImportJobEntity } from './entities/marketplace-import-job.entity';
import {
  classifyMarketplaceImportFailure,
  computeImportInProgressRetryDelayMs,
  computeMarketplaceImportRetryDelayMs,
  shouldSoftRetryImportInProgress,
} from './marketplace-import-failure-classifier';
import { loadMarketplaceImportJobRuntimeConfig } from './marketplace-import-job.config';
import {
  assertMarketplaceImportJobTransition,
  shouldRetainActiveDedupKey,
} from './marketplace-import-job-state-machine';
import {
  MarketplaceImportAcceptedJob,
  MarketplaceImportCreateResult,
  MarketplaceImportJobPublicStatus,
  MarketplaceImportJobStatus,
  MarketplaceImportRequestType,
} from './marketplace-import-job.types';
import {
  buildActiveDedupKey,
  MarketplaceSourceIdentity,
} from './marketplace-source-identity.util';
import { sourcePathFromCanonicalUrl } from './marketplace-url.validator';
import { MarketplaceImportJobPriorityBand } from '../catalog-lifecycle/catalog-lifecycle.types';
import { toCustomerSafeImportError } from './marketplace-import-customer-errors';

export interface ClaimedMarketplaceImportJob {
  job: MarketplaceImportJobEntity;
  claimToken: string;
}

@Injectable()
export class MarketplaceImportJobService {
  private readonly logger = new Logger(MarketplaceImportJobService.name);
  private readonly config = loadMarketplaceImportJobRuntimeConfig();

  constructor(
    @InjectRepository(MarketplaceImportJobEntity)
    private readonly jobRepository: Repository<MarketplaceImportJobEntity>,
    private readonly connection: Connection,
  ) {}

  async createOrReuseCustomerJob(
    identity: MarketplaceSourceIdentity,
    requesterIpHash: string | null,
    requestCorrelationId: string | null,
  ): Promise<MarketplaceImportCreateResult | null> {
    const activeJob = await this.findActiveJobByIdentity(identity);
    if (activeJob) {
      return {
        kind: 'job',
        job: this.toAcceptedJob(activeJob),
      };
    }

    const now = new Date(dateTime());
    const activeDedupKey = buildActiveDedupKey(identity);
    const publicAccessToken = this.generateToken();

    const job = this.jobRepository.create({
      source: identity.source,
      sourceProductId: identity.sourceProductId,
      canonicalSourceUrl: identity.canonicalUrl,
      requestType: MarketplaceImportRequestType.customer,
      priority: MarketplaceImportJobPriorityBand.USER_IMPORT,
      status: MarketplaceImportJobStatus.queued,
      attemptCount: 0,
      maxAttempts: this.config.maxAttempts,
      nextAttemptAt: null,
      claimedAt: null,
      claimExpiresAt: null,
      claimToken: null,
      activeDedupKey,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      productId: null,
      errorCode: null,
      errorMessage: null,
      requesterIpHash,
      publicAccessToken,
      requestCorrelationId,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const saved = await this.jobRepository.save(job);
      this.logTransition(saved, null, MarketplaceImportJobStatus.queued, 0);
      return {
        kind: 'job',
        job: this.toAcceptedJob(saved),
      };
    } catch (error) {
      if (!this.isDuplicateActiveDedupKeyError(error)) {
        throw error;
      }

      const existing = await this.findActiveJobByIdentity(identity);
      if (!existing) {
        throw error;
      }

      return {
        kind: 'job',
        job: this.toAcceptedJob(existing),
      };
    }
  }

  /**
   * Background curated catalog refresh job (lower priority than customer imports).
   * Reuses active dedup identity — will not double-enqueue same source+sourceId.
   */
  async createOrReuseCatalogRefreshJob(
    identity: MarketplaceSourceIdentity,
    priority: number,
  ): Promise<MarketplaceImportCreateResult | null> {
    const activeJob = await this.findActiveJobByIdentity(identity);
    if (activeJob) {
      return {
        kind: 'job',
        job: this.toAcceptedJob(activeJob),
      };
    }

    const now = new Date(dateTime());
    const activeDedupKey = buildActiveDedupKey(identity);
    const publicAccessToken = this.generateToken();
    // A5: allow COMMERCE_PRIORITY for discounted/hot curated refresh,
    // but never reach USER_IMPORT (customer paste-link must stay first).
    const boundedPriority = Math.max(
      MarketplaceImportJobPriorityBand.OOS_RECHECK,
      Math.min(
        MarketplaceImportJobPriorityBand.COMMERCE_PRIORITY,
        Math.floor(priority),
      ),
    );

    const job = this.jobRepository.create({
      source: identity.source,
      sourceProductId: identity.sourceProductId,
      canonicalSourceUrl: identity.canonicalUrl,
      requestType: MarketplaceImportRequestType.scheduled,
      priority: boundedPriority,
      status: MarketplaceImportJobStatus.queued,
      attemptCount: 0,
      maxAttempts: this.config.maxAttempts,
      nextAttemptAt: null,
      claimedAt: null,
      claimExpiresAt: null,
      claimToken: null,
      activeDedupKey,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      productId: null,
      errorCode: null,
      errorMessage: null,
      requesterIpHash: null,
      publicAccessToken,
      requestCorrelationId: null,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const saved = await this.jobRepository.save(job);
      this.logTransition(saved, null, MarketplaceImportJobStatus.queued, 0);
      return {
        kind: 'job',
        job: this.toAcceptedJob(saved),
      };
    } catch (error) {
      if (!this.isDuplicateActiveDedupKeyError(error)) {
        throw error;
      }

      const existing = await this.findActiveJobByIdentity(identity);
      if (!existing) {
        throw error;
      }

      return {
        kind: 'job',
        job: this.toAcceptedJob(existing),
      };
    }
  }

  async findActiveJobByIdentity(
    identity: MarketplaceSourceIdentity,
  ): Promise<MarketplaceImportJobEntity | null> {
    return this.jobRepository.findOne({
      where: {
        source: identity.source,
        sourceProductId: identity.sourceProductId,
        status: In([
          MarketplaceImportJobStatus.queued,
          MarketplaceImportJobStatus.processing,
          MarketplaceImportJobStatus.retry_wait,
        ]),
      },
      order: { id: 'ASC' },
    });
  }

  async getPublicJobStatus(
    jobId: number,
    accessToken: string,
  ): Promise<MarketplaceImportJobPublicStatus> {
    const job = await this.jobRepository.findOne({ where: { id: jobId } });
    if (!job || job.publicAccessToken !== accessToken) {
      throw new NotFoundException({
        success: false,
        messages: ['درخواست دریافت محصول یافت نشد.'],
        data: {},
      });
    }

    return this.toPublicStatus(job);
  }

  async recoverExpiredClaims(): Promise<number> {
    const now = new Date(dateTime());
    const expiredJobs = await this.jobRepository
      .createQueryBuilder('job')
      .where('job.status = :status', {
        status: MarketplaceImportJobStatus.processing,
      })
      .andWhere('job.claimExpiresAt IS NOT NULL')
      .andWhere('job.claimExpiresAt < :now', { now })
      .getMany();

    let recovered = 0;
    for (const job of expiredJobs) {
      const transitioned = await this.transitionExpiredProcessingJob(
        job.id,
        now,
      );
      if (transitioned) {
        recovered += 1;
      }
    }

    return recovered;
  }

  async claimNextEligibleJob(): Promise<ClaimedMarketplaceImportJob | null> {
    return this.connection.transaction(async (manager) => {
      const now = new Date(dateTime());
      const jobRepo = manager.getRepository(MarketplaceImportJobEntity);

      const candidate = await jobRepo
        .createQueryBuilder('job')
        .setLock('pessimistic_write')
        .where('job.status IN (:...statuses)', {
          statuses: [
            MarketplaceImportJobStatus.queued,
            MarketplaceImportJobStatus.retry_wait,
          ],
        })
        .andWhere(
          new Brackets((qb) => {
            qb.where('job.nextAttemptAt IS NULL').orWhere(
              'job.nextAttemptAt <= :now',
              { now },
            );
          }),
        )
        .orderBy('job.priority', 'DESC')
        .addOrderBy('job.createdAt', 'ASC')
        .getOne();

      if (!candidate) {
        return null;
      }

      const claimToken = this.generateToken();
      const claimExpiresAt = new Date(now.getTime() + this.config.leaseMs);

      assertMarketplaceImportJobTransition(
        candidate.status,
        MarketplaceImportJobStatus.processing,
      );

      const updateResult = await jobRepo.update(
        {
          id: candidate.id,
          status: candidate.status,
          claimToken: candidate.claimToken,
        },
        {
          status: MarketplaceImportJobStatus.processing,
          claimToken,
          claimedAt: now,
          claimExpiresAt,
          startedAt: candidate.startedAt ?? now,
          attemptCount: candidate.attemptCount + 1,
          updatedAt: now,
        },
      );

      if (!updateResult.affected) {
        return null;
      }

      const claimed = await jobRepo.findOne({ where: { id: candidate.id } });
      if (!claimed) {
        return null;
      }

      this.logTransition(
        claimed,
        candidate.status,
        MarketplaceImportJobStatus.processing,
        claimed.attemptCount,
      );

      return { job: claimed, claimToken };
    });
  }

  async claimEligibleJobById(
    jobId: number,
  ): Promise<ClaimedMarketplaceImportJob | null> {
    return this.connection.transaction(async (manager) => {
      const now = new Date(dateTime());
      const jobRepo = manager.getRepository(MarketplaceImportJobEntity);

      const candidate = await jobRepo
        .createQueryBuilder('job')
        .setLock('pessimistic_write')
        .where('job.id = :jobId', { jobId })
        .andWhere('job.status IN (:...statuses)', {
          statuses: [
            MarketplaceImportJobStatus.queued,
            MarketplaceImportJobStatus.retry_wait,
          ],
        })
        .andWhere(
          new Brackets((qb) => {
            qb.where('job.nextAttemptAt IS NULL').orWhere(
              'job.nextAttemptAt <= :now',
              { now },
            );
          }),
        )
        .getOne();

      if (!candidate) {
        return null;
      }

      const claimToken = this.generateToken();
      const claimExpiresAt = new Date(now.getTime() + this.config.leaseMs);

      assertMarketplaceImportJobTransition(
        candidate.status,
        MarketplaceImportJobStatus.processing,
      );

      const updateResult = await jobRepo.update(
        {
          id: candidate.id,
          status: candidate.status,
          claimToken: candidate.claimToken,
        },
        {
          status: MarketplaceImportJobStatus.processing,
          claimToken,
          claimedAt: now,
          claimExpiresAt,
          startedAt: candidate.startedAt ?? now,
          attemptCount: candidate.attemptCount + 1,
          updatedAt: now,
        },
      );

      if (!updateResult.affected) {
        return null;
      }

      const claimed = await jobRepo.findOne({ where: { id: candidate.id } });
      if (!claimed) {
        return null;
      }

      return { job: claimed, claimToken };
    });
  }

  async markJobSucceeded(
    jobId: number,
    claimToken: string,
    productId: number,
  ): Promise<boolean> {
    const now = new Date(dateTime());
    const result = await this.jobRepository.update(
      {
        id: jobId,
        claimToken,
        status: MarketplaceImportJobStatus.processing,
      },
      {
        status: MarketplaceImportJobStatus.succeeded,
        productId,
        activeDedupKey: null,
        completedAt: now,
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        updatedAt: now,
      },
    );

    if (!result.affected) {
      return false;
    }

    const job = await this.jobRepository.findOne({ where: { id: jobId } });
    if (job) {
      this.logTransition(
        job,
        MarketplaceImportJobStatus.processing,
        MarketplaceImportJobStatus.succeeded,
        job.attemptCount,
      );
    }

    return true;
  }

  /**
   * Shutdown path: return a claimed job to retry_wait without abandoning ownership.
   * Always retryable so a claim that resolved after shutdown began is not stranded.
   */
  async releaseClaimForShutdown(
    jobId: number,
    claimToken: string,
  ): Promise<boolean> {
    const job = await this.jobRepository.findOne({
      where: {
        id: jobId,
        claimToken,
        status: MarketplaceImportJobStatus.processing,
      },
    });

    if (!job) {
      return false;
    }

    const now = new Date(dateTime());
    assertMarketplaceImportJobTransition(
      MarketplaceImportJobStatus.processing,
      MarketplaceImportJobStatus.retry_wait,
    );

    await this.jobRepository.update(
      { id: jobId, claimToken },
      {
        status: MarketplaceImportJobStatus.retry_wait,
        nextAttemptAt: now,
        // Undo the claim attempt burn — shutdown interrupted before work.
        attemptCount: Math.max(0, job.attemptCount - 1),
        errorCode: 'WORKER_SHUTDOWN',
        errorMessage: 'پردازش به دلیل توقف سرویس متوقف شد و دوباره تلاش می‌شود.',
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        activeDedupKey: buildActiveDedupKey({
          source: job.source,
          sourceProductId: job.sourceProductId,
          canonicalUrl: job.canonicalSourceUrl,
          sourceUrl: sourcePathFromCanonicalUrl(job.canonicalSourceUrl),
        }),
        updatedAt: now,
      },
    );

    this.logTransition(
      job,
      MarketplaceImportJobStatus.processing,
      MarketplaceImportJobStatus.retry_wait,
      job.attemptCount,
      'WORKER_SHUTDOWN',
    );
    return true;
  }

  async markJobFailed(
    jobId: number,
    claimToken: string,
    errorCode: string,
    errorMessage: string,
    retryable: boolean,
  ): Promise<boolean> {
    const job = await this.jobRepository.findOne({
      where: {
        id: jobId,
        claimToken,
        status: MarketplaceImportJobStatus.processing,
      },
    });

    if (!job) {
      return false;
    }

    const now = new Date(dateTime());
    const softInProgress = shouldSoftRetryImportInProgress(
      errorCode,
      job.createdAt,
      now,
    );
    const shouldRetry =
      retryable &&
      (errorCode === 'IMPORT_IN_PROGRESS'
        ? softInProgress
        : job.attemptCount < job.maxAttempts);

    if (shouldRetry) {
      const delayMs = softInProgress
        ? computeImportInProgressRetryDelayMs(
            this.config.retryBaseMs,
            this.config.retryMaxMs,
          )
        : computeMarketplaceImportRetryDelayMs(
            job.attemptCount,
            this.config.retryBaseMs,
            this.config.retryMaxMs,
          );
      const nextAttemptAt = new Date(now.getTime() + delayMs);

      assertMarketplaceImportJobTransition(
        MarketplaceImportJobStatus.processing,
        MarketplaceImportJobStatus.retry_wait,
      );

      await this.jobRepository.update(
        { id: jobId, claimToken },
        {
          status: MarketplaceImportJobStatus.retry_wait,
          nextAttemptAt,
          // Soft in-progress waits must not burn permanent attempt budget while
          // another crawler owner still holds the identity lease.
          attemptCount: softInProgress
            ? Math.max(0, job.attemptCount - 1)
            : job.attemptCount,
          errorCode,
          errorMessage,
          claimToken: null,
          claimedAt: null,
          claimExpiresAt: null,
          activeDedupKey: buildActiveDedupKey({
            source: job.source,
            sourceProductId: job.sourceProductId,
            canonicalUrl: job.canonicalSourceUrl,
            sourceUrl: sourcePathFromCanonicalUrl(job.canonicalSourceUrl),
          }),
          updatedAt: now,
        },
      );

      this.logTransition(
        job,
        MarketplaceImportJobStatus.processing,
        MarketplaceImportJobStatus.retry_wait,
        job.attemptCount,
        errorCode,
      );
      return true;
    }

    assertMarketplaceImportJobTransition(
      MarketplaceImportJobStatus.processing,
      MarketplaceImportJobStatus.failed,
    );

    await this.jobRepository.update(
      { id: jobId, claimToken },
      {
        status: MarketplaceImportJobStatus.failed,
        failedAt: now,
        errorCode,
        errorMessage,
        activeDedupKey: null,
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        updatedAt: now,
      },
    );

    this.logTransition(
      job,
      MarketplaceImportJobStatus.processing,
      MarketplaceImportJobStatus.failed,
      job.attemptCount,
      errorCode,
    );
    return true;
  }

  async reconcileSucceededProduct(
    jobId: number,
    claimToken: string,
    productId: number,
  ): Promise<boolean> {
    return this.markJobSucceeded(jobId, claimToken, productId);
  }

  async getProcessingJob(
    jobId: number,
    claimToken: string,
  ): Promise<MarketplaceImportJobEntity | null> {
    return this.jobRepository.findOne({
      where: {
        id: jobId,
        claimToken,
        status: MarketplaceImportJobStatus.processing,
      },
    });
  }

  classifyFailure(error: unknown) {
    return classifyMarketplaceImportFailure(error);
  }

  getPollIntervalMs(): number {
    return this.config.pollIntervalMs;
  }

  isWorkerEnabled(): boolean {
    return (
      this.config.workerEnabled &&
      process.env.NODE_ENV !== 'test' &&
      !process.env.JEST_WORKER_ID
    );
  }

  private async transitionExpiredProcessingJob(
    jobId: number,
    now: Date,
  ): Promise<boolean> {
    const job = await this.jobRepository.findOne({
      where: {
        id: jobId,
        status: MarketplaceImportJobStatus.processing,
      },
    });

    if (!job || !job.claimExpiresAt || job.claimExpiresAt >= now) {
      return false;
    }

    const shouldRetry = job.attemptCount < job.maxAttempts;
    const nextStatus = shouldRetry
      ? MarketplaceImportJobStatus.retry_wait
      : MarketplaceImportJobStatus.failed;

    assertMarketplaceImportJobTransition(
      MarketplaceImportJobStatus.processing,
      nextStatus,
    );

    const nextAttemptAt = shouldRetry
      ? new Date(
          now.getTime() +
            computeMarketplaceImportRetryDelayMs(
              job.attemptCount,
              this.config.retryBaseMs,
              this.config.retryMaxMs,
            ),
        )
      : null;

    const updateResult = await this.jobRepository.update(
      {
        id: jobId,
        status: MarketplaceImportJobStatus.processing,
        claimExpiresAt: job.claimExpiresAt,
        claimToken: job.claimToken,
      },
      {
        status: nextStatus,
        nextAttemptAt,
        failedAt: shouldRetry ? null : now,
        errorCode: shouldRetry ? 'CLAIM_EXPIRED' : 'MAX_ATTEMPTS_EXCEEDED',
        errorMessage: shouldRetry
          ? 'مهلت پردازش درخواست به پایان رسید. تلاش مجدد برنامه‌ریزی شد.'
          : 'دریافت اطلاعات محصول پس از چند تلاش ناموفق بود.',
        activeDedupKey: shouldRetainActiveDedupKey(nextStatus)
          ? buildActiveDedupKey({
              source: job.source,
              sourceProductId: job.sourceProductId,
              canonicalUrl: job.canonicalSourceUrl,
              sourceUrl: sourcePathFromCanonicalUrl(job.canonicalSourceUrl),
            })
          : null,
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        updatedAt: now,
      },
    );

    if (!updateResult.affected) {
      return false;
    }

    this.logger.warn(
      `Recovered expired marketplace import job ${jobId} -> ${nextStatus}`,
    );
    return true;
  }

  private toAcceptedJob(
    job: MarketplaceImportJobEntity,
  ): MarketplaceImportAcceptedJob {
    return {
      jobId: job.id,
      accessToken: job.publicAccessToken,
      status: job.status,
    };
  }

  private toPublicStatus(
    job: MarketplaceImportJobEntity,
  ): MarketplaceImportJobPublicStatus {
    const publicError =
      job.errorCode || job.errorMessage
        ? toCustomerSafeImportError(job.errorCode, job.errorMessage)
        : null;

    return {
      jobId: job.id,
      status: job.status,
      productId: job.productId ?? undefined,
      errorCode: publicError?.code,
      errorMessage: publicError?.message,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      completedAt: job.completedAt?.toISOString(),
      failedAt: job.failedAt?.toISOString(),
    };
  }

  private generateToken(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  private isDuplicateActiveDedupKeyError(error: unknown): boolean {
    const code = (error as any)?.code || (error as any)?.errno;
    return code === 'ER_DUP_ENTRY' || code === 1062;
  }

  private logTransition(
    job: MarketplaceImportJobEntity,
    from: MarketplaceImportJobStatus | null,
    to: MarketplaceImportJobStatus,
    attempt: number,
    errorCode?: string,
  ): void {
    this.logger.log(
      JSON.stringify({
        event: 'marketplace_import_job_transition',
        jobId: job.id,
        source: job.source,
        sourceProductId: job.sourceProductId,
        from,
        to,
        attempt,
        errorCode: errorCode || null,
        requestType: job.requestType,
      }),
    );
  }
}
