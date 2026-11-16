import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProductEntity } from '../product/entities/product.entity';
import { MarketplaceImportJobEntity } from '../marketplace-import/entities/marketplace-import-job.entity';
import { MarketplaceImportJobService } from '../marketplace-import/marketplace-import-job.service';
import {
  CatalogLifecycleRuntimeConfig,
  loadCatalogLifecycleRuntimeConfig,
} from './catalog-lifecycle.config';
import {
  compareAdaptiveRefreshCandidates,
  evaluateCatalogRefreshEligibility,
  type CatalogRefreshCandidateInput,
} from './catalog-refresh-eligibility';
import {
  SHOWCASE_PILOT_ALLOWED_SOURCE,
  SHOWCASE_PILOT_DEFAULT_PRODUCT_IDS,
  SHOWCASE_PILOT_LIVE_ENABLED_ENV,
  SHOWCASE_PILOT_MAX_IDS,
} from './showcase-pilot.constants';
import {
  assertShowcasePilotLiveAllowed,
  isShowcasePilotAllowedSource,
  mapJobStatusToPilotOutcome,
  normalizeShowcasePilotProductIds,
  type ShowcasePilotMode,
  type ShowcasePilotProductOutcome,
} from './showcase-pilot-refresh.policy';

export type ShowcasePilotRefreshInput = {
  mode?: ShowcasePilotMode;
  dryRun?: boolean;
  productIds?: number[];
  /** When true (default), re-check latest job status for succeeded/failed. */
  includeJobOutcomes?: boolean;
};

export type ShowcasePilotProductResult = {
  productId: number;
  outcome: ShowcasePilotProductOutcome;
  reason: string;
  source?: string | null;
  sourceId?: string | null;
  tier?: string | null;
  priority?: number | null;
  jobId?: number | null;
  jobStatus?: string | null;
  sourceAvailability?: string | null;
  sourceSyncStatus?: string | null;
  detail?: string | null;
};

export type ShowcasePilotRefreshReport = {
  mode: ShowcasePilotMode;
  liveEnqueueAttempted: boolean;
  liveBlockedReason: string | null;
  liveFlagEnv: string;
  liveFlagEnabled: boolean;
  maxIds: number;
  allowedSource: string;
  maxConcurrencyPerSource: number;
  submittedIds: number[];
  submittedCount: number;
  results: ShowcasePilotProductResult[];
  counts: {
    selected: number;
    skipped: number;
    enqueued: number;
    reused_active: number;
    succeeded: number;
    failed: number;
  };
  expectedExternalRequestsIfLive: number;
  confirmation: {
    curatedMembershipUnchanged: true;
    globalSchedulerUnchanged: true;
    dryRunPerformsNoEnqueue: boolean;
  };
};

@Injectable()
export class ShowcasePilotRefreshService {
  private readonly logger = new Logger(ShowcasePilotRefreshService.name);
  private readonly config: CatalogLifecycleRuntimeConfig;

  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    @InjectRepository(MarketplaceImportJobEntity)
    private readonly jobRepository: Repository<MarketplaceImportJobEntity>,
    private readonly jobService: MarketplaceImportJobService,
  ) {
    this.config = loadCatalogLifecycleRuntimeConfig();
  }

  async execute(
    input: ShowcasePilotRefreshInput = {},
  ): Promise<ShowcasePilotRefreshReport> {
    const mode: ShowcasePilotMode =
      input.mode === 'live' || input.dryRun === false ? 'live' : 'dry_run';

    const rawIds =
      input.productIds && input.productIds.length
        ? input.productIds
        : [...SHOWCASE_PILOT_DEFAULT_PRODUCT_IDS];
    const normalized = normalizeShowcasePilotProductIds(rawIds);
    if (normalized.ok === false) {
      throw new BadRequestException({
        success: false,
        messages: [normalized.error],
        data: { code: 'INVALID_SHOWCASE_PILOT_IDS' },
      });
    }

    const submittedIds = normalized.ids;
    const liveGate = assertShowcasePilotLiveAllowed(mode);
    const liveEnqueueAttempted = mode === 'live';
    const canEnqueue = liveEnqueueAttempted && liveGate.allowed;

    const products = await this.productRepository.find({
      where: { id: In(submittedIds) },
      select: [
        'id',
        'source',
        'sourceId',
        'sourceUrl',
        'supplyType',
        'isCuratedExternalCatalog',
        'sourceAvailability',
        'sourceSyncStatus',
        'availabilityLastConfirmedAt',
        'sourceLastAttemptAt',
        'createdAt',
        'price',
        'discountedPrice',
        'isDeleted',
      ],
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const now = new Date();
    type Ranked = {
      productId: number;
      candidate: CatalogRefreshCandidateInput;
      decision: ReturnType<typeof evaluateCatalogRefreshEligibility>;
    };
    const ranked: Ranked[] = [];
    const earlyResults: ShowcasePilotProductResult[] = [];

    for (const productId of submittedIds) {
      const row = byId.get(productId);
      if (!row || row.isDeleted) {
        earlyResults.push({
          productId,
          outcome: 'skipped',
          reason: row?.isDeleted ? 'product_deleted' : 'product_not_found',
        });
        continue;
      }
      if (!isShowcasePilotAllowedSource(row.source)) {
        earlyResults.push({
          productId,
          outcome: 'skipped',
          reason: 'source_not_trendyol',
          source: row.source,
          sourceId: row.sourceId,
        });
        continue;
      }
      if (!row.sourceId) {
        earlyResults.push({
          productId,
          outcome: 'skipped',
          reason: 'missing_source_identity',
          source: row.source,
        });
        continue;
      }

      const candidate: CatalogRefreshCandidateInput = {
        id: row.id,
        source: row.source,
        sourceId: row.sourceId,
        sourceUrl: row.sourceUrl,
        supplyType: row.supplyType,
        isCuratedExternalCatalog: row.isCuratedExternalCatalog === true,
        sourceAvailability: row.sourceAvailability,
        sourceSyncStatus: row.sourceSyncStatus,
        availabilityLastConfirmedAt: row.availabilityLastConfirmedAt,
        sourceLastAttemptAt: row.sourceLastAttemptAt,
        createdAt: row.createdAt,
        price: row.price != null ? Number(row.price) : null,
        discountedPrice:
          row.discountedPrice != null ? Number(row.discountedPrice) : null,
        hasRecentCartDemand: false,
      };
      const decision = evaluateCatalogRefreshEligibility(
        candidate,
        now,
        this.config,
      );
      if (!decision.eligible || !decision.reason || !decision.priorityClass) {
        earlyResults.push({
          productId,
          outcome: 'skipped',
          reason: decision.detail || 'ineligible',
          source: row.source,
          sourceId: row.sourceId,
          sourceAvailability: String(row.sourceAvailability),
          sourceSyncStatus: String(row.sourceSyncStatus),
          detail: decision.detail,
        });
        continue;
      }
      ranked.push({ productId, candidate, decision });
    }

    ranked.sort((a, b) =>
      compareAdaptiveRefreshCandidates(
        { product: a.candidate, decision: a.decision },
        { product: b.candidate, decision: b.decision },
      ),
    );

    const selectedPerSource = new Map<string, number>();
    const planned: Ranked[] = [];
    for (const row of ranked) {
      const source = String(row.candidate.source);
      const already = selectedPerSource.get(source) || 0;
      if (already >= this.config.maxConcurrencyPerSource) {
        earlyResults.push({
          productId: row.productId,
          outcome: 'skipped',
          reason: 'per_source_concurrency',
          source,
          sourceId: row.candidate.sourceId,
          tier: row.decision.tier || null,
          priority: row.decision.priority,
          detail: `maxConcurrencyPerSource=${this.config.maxConcurrencyPerSource}`,
        });
        continue;
      }
      selectedPerSource.set(source, already + 1);
      planned.push(row);
    }

    const actionResults: ShowcasePilotProductResult[] = [];

    for (const row of planned) {
      const source = String(row.candidate.source);
      const sourceId = String(row.candidate.sourceId);
      const base = {
        productId: row.productId,
        source,
        sourceId,
        tier: row.decision.tier || null,
        priority: row.decision.priority,
        sourceAvailability: String(row.candidate.sourceAvailability),
        sourceSyncStatus: String(row.candidate.sourceSyncStatus),
        detail: row.decision.detail || row.decision.reason || null,
      };

      if (!canEnqueue) {
        actionResults.push({
          ...base,
          outcome: 'selected',
          reason: row.decision.reason || 'eligible',
        });
        continue;
      }

      const canonicalUrl = row.candidate.sourceUrl?.startsWith('http')
        ? row.candidate.sourceUrl
        : `https://www.trendyol.com${row.candidate.sourceUrl || ''}`;

      const active = await this.jobService.findActiveJobByIdentity({
        source,
        sourceProductId: sourceId,
        canonicalUrl,
        sourceUrl: canonicalUrl,
      });
      if (active) {
        actionResults.push({
          ...base,
          outcome: 'reused_active',
          reason: 'active_job_dedup',
          jobId: active.id,
          jobStatus: active.status,
        });
        continue;
      }

      const created = await this.jobService.createOrReuseCatalogRefreshJob(
        {
          source,
          sourceProductId: sourceId,
          canonicalUrl,
          sourceUrl: canonicalUrl,
        },
        row.decision.priority,
      );

      if (created?.kind === 'job') {
        actionResults.push({
          ...base,
          outcome: 'enqueued',
          reason: row.decision.reason || 'enqueued',
          jobId: created.job.jobId,
          jobStatus: created.job.status,
        });
        this.logger.log(
          JSON.stringify({
            event: 'showcase_pilot_job_enqueued',
            productId: row.productId,
            jobId: created.job.jobId,
            source,
            reason: row.decision.reason,
            tier: row.decision.tier,
          }),
        );
      } else {
        actionResults.push({
          ...base,
          outcome: 'skipped',
          reason: 'enqueue_failed',
        });
      }
    }

    let results = [...earlyResults, ...actionResults];

    if (input.includeJobOutcomes !== false) {
      results = await this.enrichWithJobOutcomes(results);
    }

    // Stable order: original allowlist order
    const order = new Map(submittedIds.map((id, i) => [id, i]));
    results.sort(
      (a, b) => (order.get(a.productId) ?? 0) - (order.get(b.productId) ?? 0),
    );

    const counts = {
      selected: 0,
      skipped: 0,
      enqueued: 0,
      reused_active: 0,
      succeeded: 0,
      failed: 0,
    };
    for (const r of results) {
      counts[r.outcome] += 1;
    }

    // In dry_run, "selected" is the would-be enqueue set (already concurrency-capped).
    const drySelected = results.filter((r) => r.outcome === 'selected').length;

    return {
      mode,
      liveEnqueueAttempted,
      liveBlockedReason: liveEnqueueAttempted
        ? liveGate.blockedReason
        : null,
      liveFlagEnv: SHOWCASE_PILOT_LIVE_ENABLED_ENV,
      liveFlagEnabled: liveGate.allowed || isShowcasePilotLiveFlagRaw(),
      maxIds: SHOWCASE_PILOT_MAX_IDS,
      allowedSource: SHOWCASE_PILOT_ALLOWED_SOURCE,
      maxConcurrencyPerSource: this.config.maxConcurrencyPerSource,
      submittedIds,
      submittedCount: submittedIds.length,
      results,
      counts,
      expectedExternalRequestsIfLive:
        mode === 'dry_run'
          ? drySelected
          : counts.enqueued + counts.reused_active,
      confirmation: {
        curatedMembershipUnchanged: true,
        globalSchedulerUnchanged: true,
        dryRunPerformsNoEnqueue: mode === 'dry_run',
      },
    };
  }

  /**
   * Resume helper: fold latest job status for allowlisted identities into
   * succeeded/failed without re-enqueueing.
   */
  private async enrichWithJobOutcomes(
    results: ShowcasePilotProductResult[],
  ): Promise<ShowcasePilotProductResult[]> {
    const pairs = results.filter((r) => r.source && r.sourceId);
    if (!pairs.length) return results;

    const sources = [...new Set(pairs.map((p) => String(p.source)))];
    const sourceIds = [...new Set(pairs.map((p) => String(p.sourceId)))];
    const jobs = await this.jobRepository
      .createQueryBuilder('job')
      .where('job.source IN (:...sources)', { sources })
      .andWhere('job.sourceProductId IN (:...sourceIds)', { sourceIds })
      .orderBy('job.id', 'DESC')
      .getMany();

    const latestByIdentity = new Map<string, MarketplaceImportJobEntity>();
    for (const job of jobs) {
      const key = `${job.source}:${job.sourceProductId}`;
      if (!latestByIdentity.has(key)) {
        latestByIdentity.set(key, job);
      }
    }

    return results.map((row) => {
      if (!row.source || !row.sourceId) return row;
      // Don't overwrite explicit enqueue outcomes from this run.
      if (row.outcome === 'enqueued' || row.outcome === 'selected') return row;
      if (row.outcome === 'reused_active') {
        const key = `${row.source}:${row.sourceId}`;
        const job = latestByIdentity.get(key);
        if (!job) return row;
        const mapped = mapJobStatusToPilotOutcome(job.status);
        if (mapped === 'succeeded' || mapped === 'failed') {
          return {
            ...row,
            outcome: mapped,
            reason:
              mapped === 'succeeded'
                ? 'job_succeeded'
                : job.errorCode || 'job_failed',
            jobId: job.id,
            jobStatus: job.status,
            detail: job.errorMessage,
          };
        }
        return {
          ...row,
          jobId: job.id,
          jobStatus: job.status,
        };
      }
      if (row.outcome === 'skipped') {
        const key = `${row.source}:${row.sourceId}`;
        const job = latestByIdentity.get(key);
        if (!job) return row;
        const mapped = mapJobStatusToPilotOutcome(job.status);
        // Resume: if a prior pilot job already succeeded, surface it.
        if (mapped === 'succeeded' || mapped === 'failed') {
          return {
            ...row,
            outcome: mapped,
            reason:
              mapped === 'succeeded'
                ? 'prior_job_succeeded'
                : job.errorCode || 'prior_job_failed',
            jobId: job.id,
            jobStatus: job.status,
            detail: job.errorMessage,
          };
        }
      }
      return row;
    });
  }
}

function isShowcasePilotLiveFlagRaw(): boolean {
  const raw = process.env[SHOWCASE_PILOT_LIVE_ENABLED_ENV];
  if (raw == null || String(raw).trim() === '') return false;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
