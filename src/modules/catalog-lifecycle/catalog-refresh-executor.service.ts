import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProductEntity } from '../product/entities/product.entity';
import { CartItemEntity } from '../cart/entities/cart-item.entity';
import { ACTIVE_MARKETPLACE_IMPORT_JOB_STATUSES } from '../marketplace-import/marketplace-import-job.types';
import { MarketplaceImportJobEntity } from '../marketplace-import/entities/marketplace-import-job.entity';
import { MarketplaceImportJobService } from '../marketplace-import/marketplace-import-job.service';
import {
  CatalogLifecycleRuntimeConfig,
  loadCatalogLifecycleRuntimeConfig,
} from './catalog-lifecycle.config';
import { ProductSupplyType } from './catalog-lifecycle.types';
import { CatalogRefreshCircuitBreaker } from './catalog-refresh-circuit-breaker';
import {
  CatalogRefreshCandidateInput,
  compareAdaptiveRefreshCandidates,
  evaluateCatalogRefreshEligibility,
} from './catalog-refresh-eligibility';
import { SourceCommercialAvailability } from '../source-availability';
import {
  CatalogRefreshCheckpointEntity,
  CatalogRefreshCheckpointSnapshot,
  catalogRefreshCheckpointScopeKey,
} from './entities/catalog-refresh-checkpoint.entity';
import { computeCatalogRefreshScanProgress } from './catalog-refresh-progression';
import { isMysqlDuplicateKeyError } from '../order/utils/duplicate-key.util';
import {
  assortmentInScopeDiscoverySql,
  isAssortmentCrawlerEnforcementEnabled,
} from '../catalog/assortment-policy/assortment-enforcement';

export type CatalogRefreshRunMode = 'dry_run' | 'live';

export type CatalogRefreshExecutorInput = {
  mode: CatalogRefreshRunMode;
  maxItems?: number;
  source?: string;
  /** Optional keyset continuation (exclusive lower bound on product id). */
  afterProductId?: number;
};

export type CatalogRefreshSampleRow = {
  productId: number;
  source: string;
  sourceId: string;
  reason: string;
  priorityClass: string;
  tier: string;
  priority: number;
  currentlyDiscounted: boolean;
  freshnessAgeMs: number | null;
  sourceAvailability: string;
  sourceSyncStatus: string;
  detail: string;
};

export type CatalogRefreshExecutorReport = {
  mode: CatalogRefreshRunMode;
  liveEnqueueAttempted: boolean;
  liveEnqueueBlockedReason: string | null;
  configuredHardMaxItems: number;
  requestedMaxItems: number;
  effectiveMaxItems: number;
  candidateWindowLoaded: number;
  candidateWindowCap: number;
  sourceFilter: string | null;
  backgroundPaused: boolean;
  circuitOpenSources: string[];
  /** Checkpoint scope key used for this run. */
  checkpointScopeKey: string;
  /** Stored checkpoint before this run. */
  storedAfterProductId: number;
  /** Stored revision before this run (0 if uninitialized). */
  storedRevision: number;
  /** Exclusive lower bound actually used for the candidate scan. */
  scanAfterProductId: number;
  /** Max product id observed in the scanned window (0 if empty). */
  scannedMaxProductId: number;
  /** Proposed next checkpoint (based on scan, not enqueue). */
  proposedNextAfterProductId: number;
  /** Whether progression wraps to the start of the keyspace. */
  cursorWrapped: boolean;
  /**
   * True only when live mode committed the checkpoint.
   * Dry-run never commits. Live blocked by kill-switch/pause does not commit.
   */
  cursorCommitted: boolean;
  /** Revision after successful commit; null when not committed. */
  committedRevision: number | null;
  totals: {
    curatedExternal: number;
    eligibleEvaluated: number;
    eligible: number;
    projectedJobs: number;
    enqueuedJobs: number;
    skippedActiveDedup: number;
    skippedCircuitOpen: number;
    skippedPerSourceConcurrency: number;
    skippedBudgetExhausted: number;
  };
  bySource: Array<{ source: string; eligible: number }>;
  byAvailability: Array<{ sourceAvailability: string; count: number }>;
  bySyncStatus: Array<{ sourceSyncStatus: string; count: number }>;
  byTier: Array<{ tier: string; count: number }>;
  freshnessBuckets: {
    neverVerifiedOrUnknown: number;
    sourceErrorEligible: number;
    availableStaleEligible: number;
    availableDiscountEligible: number;
    availableDemandEligible: number;
    unavailableRecheckEligible: number;
    otherEligible: number;
  };
  samples: CatalogRefreshSampleRow[];
  capacity: {
    externalCatalogTargetSize: number;
    externalCatalogMaxSize: number;
    curatedActiveApprox: number;
  };
};

@Injectable()
export class CatalogRefreshExecutorService {
  private readonly logger = new Logger(CatalogRefreshExecutorService.name);
  private readonly config: CatalogLifecycleRuntimeConfig;
  private readonly circuitBreaker: CatalogRefreshCircuitBreaker;

  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    @InjectRepository(MarketplaceImportJobEntity)
    private readonly jobRepository: Repository<MarketplaceImportJobEntity>,
    private readonly jobService: MarketplaceImportJobService,
    @InjectRepository(CartItemEntity)
    private readonly cartItemRepository: Repository<CartItemEntity>,
    @InjectRepository(CatalogRefreshCheckpointEntity)
    private readonly checkpointRepository: Repository<CatalogRefreshCheckpointEntity>,
  ) {
    this.config = loadCatalogLifecycleRuntimeConfig();
    this.circuitBreaker = new CatalogRefreshCircuitBreaker(this.config);
  }

  /** Exposed for tests */
  getConfig(): CatalogLifecycleRuntimeConfig {
    return this.config;
  }

  getCircuitBreaker(): CatalogRefreshCircuitBreaker {
    return this.circuitBreaker;
  }

  async execute(
    input: CatalogRefreshExecutorInput,
  ): Promise<CatalogRefreshExecutorReport> {
    const requested = input.maxItems ?? this.config.defaultBatchSize;
    if (requested < 1) {
      throw new BadRequestException({
        success: false,
        messages: ['maxItems must be >= 1'],
        data: { code: 'INVALID_MAX_ITEMS' },
      });
    }
    const effectiveMaxItems = Math.min(
      requested,
      this.config.hardMaxItemsPerRun,
    );

    const now = new Date();
    const sourceFilter = input.source?.trim() || null;
    const candidateCap = Math.min(
      this.config.maxCandidateWindow,
      Math.max(effectiveMaxItems * 8, 200),
    );

    const curatedActiveApprox = await this.productRepository
      .createQueryBuilder('product')
      .where('product.supplyType = :supply', {
        supply: ProductSupplyType.external_source,
      })
      .andWhere('product.isCuratedExternalCatalog = true')
      .andWhere('product.isDeleted = false')
      .getCount();

    const checkpointScopeKey = catalogRefreshCheckpointScopeKey(sourceFilter);
    const storedCheckpoint = await this.loadCheckpointSnapshot(
      checkpointScopeKey,
    );
    const storedAfterProductId = storedCheckpoint.afterProductId;
    const storedRevision = storedCheckpoint.revision;
    const scanAfterProductId =
      input.afterProductId != null && Number.isFinite(input.afterProductId)
        ? Math.max(0, Math.floor(input.afterProductId))
        : storedAfterProductId;

    const candidates = await this.loadCandidateWindow(
      sourceFilter,
      scanAfterProductId,
      candidateCap,
    );

    const scanProgress = computeCatalogRefreshScanProgress({
      scanAfterProductId,
      scannedProductIds: candidates.map((c) => c.id),
      candidateWindowCap: candidateCap,
    });

    const demandIds = await this.loadRecentCartDemandIds(
      candidates.map((c) => c.id),
      now,
    );

    for (const product of candidates) {
      product.hasRecentCartDemand = demandIds.has(product.id);
    }

    const { dedupKeys: activeDedupKeys, activeCountBySource: activePerSource } =
      await this.loadActiveCatalogPressure(
        candidates.map((c) => c.source).filter((s): s is string => !!s),
      );

    const samples: CatalogRefreshSampleRow[] = [];
    const bySourceMap = new Map<string, number>();
    const byAvailabilityMap = new Map<string, number>();
    const bySyncMap = new Map<string, number>();
    const byTierMap = new Map<string, number>();
    const freshness = {
      neverVerifiedOrUnknown: 0,
      sourceErrorEligible: 0,
      availableStaleEligible: 0,
      availableDiscountEligible: 0,
      availableDemandEligible: 0,
      unavailableRecheckEligible: 0,
      otherEligible: 0,
    };

    type SelectedRow = {
      product: CatalogRefreshCandidateInput;
      decision: ReturnType<typeof evaluateCatalogRefreshEligibility>;
    };

    const eligiblePool: SelectedRow[] = [];
    let eligibleEvaluated = 0;
    let skippedActiveDedup = 0;
    let skippedCircuitOpen = 0;
    let skippedPerSourceConcurrency = 0;
    let skippedBudgetExhausted = 0;
    const circuitOpenSources = new Set<string>();

    for (const product of candidates) {
      const decision = evaluateCatalogRefreshEligibility(
        product,
        now,
        this.config,
      );
      if (!decision.eligible || !decision.reason || !decision.priorityClass) {
        continue;
      }
      eligibleEvaluated += 1;
      eligiblePool.push({ product, decision });
    }

    eligiblePool.sort(compareAdaptiveRefreshCandidates);

    const selected: SelectedRow[] = [];
    const selectedPerSource = new Map<string, number>();

    for (const row of eligiblePool) {
      if (selected.length >= effectiveMaxItems) {
        skippedBudgetExhausted += 1;
        continue;
      }

      const { product, decision } = row;
      const source = product.source;
      const sourceId = product.sourceId;
      if (!source || !sourceId) {
        continue;
      }
      if (this.circuitBreaker.isOpen(source, now)) {
        circuitOpenSources.add(source);
        skippedCircuitOpen += 1;
        continue;
      }

      const dedupKey = `${source}:${sourceId}`;
      if (activeDedupKeys.has(dedupKey)) {
        skippedActiveDedup += 1;
        continue;
      }

      const alreadySelected = selectedPerSource.get(source) || 0;
      const alreadyActive = activePerSource.get(source) || 0;
      if (
        alreadySelected + alreadyActive >=
        this.config.maxConcurrencyPerSource
      ) {
        skippedPerSourceConcurrency += 1;
        continue;
      }

      selected.push(row);
      selectedPerSource.set(source, alreadySelected + 1);
      bySourceMap.set(source, (bySourceMap.get(source) || 0) + 1);
      byAvailabilityMap.set(
        String(product.sourceAvailability),
        (byAvailabilityMap.get(String(product.sourceAvailability)) || 0) + 1,
      );
      bySyncMap.set(
        String(product.sourceSyncStatus),
        (bySyncMap.get(String(product.sourceSyncStatus)) || 0) + 1,
      );
      if (decision.tier) {
        byTierMap.set(decision.tier, (byTierMap.get(decision.tier) || 0) + 1);
      }

      if (
        decision.reason === 'never_verified' ||
        decision.reason === 'unknown_availability'
      ) {
        freshness.neverVerifiedOrUnknown += 1;
      } else if (decision.reason === 'source_error_recheck') {
        freshness.sourceErrorEligible += 1;
      } else if (decision.reason === 'available_stale_discount') {
        freshness.availableDiscountEligible += 1;
      } else if (decision.reason === 'available_stale_demand') {
        freshness.availableDemandEligible += 1;
      } else if (decision.reason === 'available_stale') {
        freshness.availableStaleEligible += 1;
      } else if (decision.reason === 'unavailable_recheck') {
        freshness.unavailableRecheckEligible += 1;
      } else {
        freshness.otherEligible += 1;
      }

      this.logger.log(
        JSON.stringify({
          event: 'catalog_refresh_candidate_selected',
          productId: product.id,
          source,
          reason: decision.reason,
          tier: decision.tier,
          priorityClass: decision.priorityClass,
          priority: decision.priority,
          currentlyDiscounted: decision.currentlyDiscounted,
          freshnessAgeMs: decision.freshnessAgeMs,
          detail: decision.detail,
        }),
      );

      if (samples.length < this.config.dryRunSampleSize) {
        samples.push({
          productId: product.id,
          source,
          sourceId,
          reason: decision.reason,
          priorityClass: decision.priorityClass,
          tier: decision.tier || 'UNKNOWN',
          priority: decision.priority,
          currentlyDiscounted: decision.currentlyDiscounted,
          freshnessAgeMs: decision.freshnessAgeMs,
          sourceAvailability: String(product.sourceAvailability),
          sourceSyncStatus: String(product.sourceSyncStatus),
          detail: decision.detail,
        });
      }
    }

    if (skippedActiveDedup > 0) {
      this.logger.log(
        JSON.stringify({
          event: 'catalog_refresh_skipped_active_work',
          count: skippedActiveDedup,
        }),
      );
    }
    if (skippedBudgetExhausted > 0) {
      this.logger.log(
        JSON.stringify({
          event: 'catalog_refresh_skipped_budget_exhausted',
          count: skippedBudgetExhausted,
          effectiveMaxItems,
        }),
      );
    }

    let liveEnqueueAttempted = false;
    let liveEnqueueBlockedReason: string | null = null;
    let enqueuedJobs = 0;
    let cursorCommitted = false;
    let committedRevision: number | null = null;

    if (input.mode === 'live') {
      liveEnqueueAttempted = true;
      if (!this.config.liveEnqueueEnabled) {
        liveEnqueueBlockedReason =
          'CATALOG_REFRESH_LIVE_ENABLED is false (default). Dry-run only.';
      } else if (this.config.backgroundPaused) {
        liveEnqueueBlockedReason = 'CATALOG_REFRESH_BACKGROUND_PAUSED is true';
      } else {
        for (const row of selected) {
          const rowSource = row.product.source;
          const rowSourceId = row.product.sourceId;
          if (!rowSource || !rowSourceId) {
            continue;
          }
          if (this.circuitBreaker.isOpen(rowSource, now)) {
            skippedCircuitOpen += 1;
            continue;
          }
          if (!row.product.sourceUrl && !row.product.source) {
            continue;
          }
          const canonicalUrl = row.product.sourceUrl?.startsWith('http')
            ? row.product.sourceUrl
            : `https://www.trendyol.com${row.product.sourceUrl || ''}`;

          const created = await this.jobService.createOrReuseCatalogRefreshJob(
            {
              source: rowSource,
              sourceProductId: rowSourceId,
              canonicalUrl,
              sourceUrl: canonicalUrl,
            },
            row.decision.priority,
          );
          if (created?.kind === 'job') {
            enqueuedJobs += 1;
            activeDedupKeys.add(`${rowSource}:${rowSourceId}`);
            this.logger.log(
              JSON.stringify({
                event: 'catalog_refresh_job_enqueued',
                productId: row.product.id,
                source: rowSource,
                priority: row.decision.priority,
                tier: row.decision.tier,
                reason: row.decision.reason,
              }),
            );
          }
        }

        // Commit progression based on SCANNED window; revision is ABA token.
        const commit = await this.commitCheckpointForwardOnly(
          checkpointScopeKey,
          storedAfterProductId,
          storedRevision,
          scanProgress.proposedNextAfterProductId,
        );
        cursorCommitted = commit.committed;
        committedRevision = commit.newRevision;
      }
    }

    this.logger.log(
      JSON.stringify({
        event: 'catalog_refresh_cycle_complete',
        mode: input.mode,
        candidateWindowLoaded: candidates.length,
        eligibleEvaluated,
        selected: selected.length,
        enqueuedJobs,
        skippedActiveDedup,
        skippedBudgetExhausted,
        skippedPerSourceConcurrency,
        scanAfterProductId,
        proposedNextAfterProductId: scanProgress.proposedNextAfterProductId,
        cursorWrapped: scanProgress.wrapped,
        cursorCommitted,
        storedRevision,
        committedRevision,
      }),
    );

    return {
      mode: input.mode,
      liveEnqueueAttempted,
      liveEnqueueBlockedReason,
      configuredHardMaxItems: this.config.hardMaxItemsPerRun,
      requestedMaxItems: requested,
      effectiveMaxItems,
      candidateWindowLoaded: candidates.length,
      candidateWindowCap: candidateCap,
      sourceFilter,
      backgroundPaused: this.config.backgroundPaused,
      circuitOpenSources: [...circuitOpenSources],
      checkpointScopeKey,
      storedAfterProductId,
      storedRevision,
      scanAfterProductId,
      scannedMaxProductId: scanProgress.scannedMaxProductId,
      proposedNextAfterProductId: scanProgress.proposedNextAfterProductId,
      cursorWrapped: scanProgress.wrapped,
      cursorCommitted,
      committedRevision,
      totals: {
        curatedExternal: curatedActiveApprox,
        eligibleEvaluated,
        eligible: selected.length,
        projectedJobs: selected.length,
        enqueuedJobs,
        skippedActiveDedup,
        skippedCircuitOpen,
        skippedPerSourceConcurrency,
        skippedBudgetExhausted,
      },
      bySource: [...bySourceMap.entries()].map(([source, eligible]) => ({
        source,
        eligible,
      })),
      byAvailability: [...byAvailabilityMap.entries()].map(
        ([sourceAvailability, count]) => ({ sourceAvailability, count }),
      ),
      bySyncStatus: [...bySyncMap.entries()].map(
        ([sourceSyncStatus, count]) => ({ sourceSyncStatus, count }),
      ),
      byTier: [...byTierMap.entries()].map(([tier, count]) => ({
        tier,
        count,
      })),
      freshnessBuckets: freshness,
      samples,
      capacity: {
        externalCatalogTargetSize: this.config.externalCatalogTargetSize,
        externalCatalogMaxSize: this.config.externalCatalogMaxSize,
        curatedActiveApprox,
      },
    };
  }

  /**
   * Bounded candidate window: curated external with identity, not removed.
   * Priority ranking happens in-process over this bounded set only.
   */
  private async loadCandidateWindow(
    source: string | null,
    afterProductId: number,
    limit: number,
  ): Promise<CatalogRefreshCandidateInput[]> {
    const qb = this.productRepository
      .createQueryBuilder('product')
      .select([
        'product.id',
        'product.source',
        'product.sourceId',
        'product.sourceUrl',
        'product.supplyType',
        'product.isCuratedExternalCatalog',
        'product.sourceAvailability',
        'product.sourceSyncStatus',
        'product.availabilityLastConfirmedAt',
        'product.sourceLastAttemptAt',
        'product.createdAt',
        'product.price',
        'product.discountedPrice',
      ])
      .where('product.supplyType = :supply', {
        supply: ProductSupplyType.external_source,
      })
      .andWhere('product.isCuratedExternalCatalog = true')
      .andWhere('product.isDeleted = false')
      .andWhere('product.source IS NOT NULL')
      .andWhere("product.source <> ''")
      .andWhere('product.sourceId IS NOT NULL')
      .andWhere("product.sourceId <> ''")
      .andWhere('product.sourceAvailability <> :removed', {
        removed: SourceCommercialAvailability.removed,
      })
      .andWhere('product.id > :afterId', { afterId: afterProductId })
      .orderBy('product.id', 'ASC')
      .take(Math.min(limit, this.config.maxCandidateWindow));

    if (source) {
      qb.andWhere('product.source = :source', { source });
    }

    // SCOPE-5/6 refresh gate: only IN_SCOPE source categories are refresh
    // eligible. REVIEW / OUT / missing resolution fail closed (no crawl work).
    if (isAssortmentCrawlerEnforcementEnabled()) {
      qb.andWhere(assortmentInScopeDiscoverySql('product'));
    }

    const rows = await qb.getMany();
    return rows.map((p) => ({
      id: p.id,
      source: p.source,
      sourceId: p.sourceId,
      sourceUrl: p.sourceUrl,
      supplyType: p.supplyType,
      isCuratedExternalCatalog: p.isCuratedExternalCatalog,
      sourceAvailability: p.sourceAvailability,
      sourceSyncStatus: p.sourceSyncStatus,
      availabilityLastConfirmedAt: p.availabilityLastConfirmedAt,
      sourceLastAttemptAt: p.sourceLastAttemptAt,
      createdAt: p.createdAt,
      price: p.price,
      discountedPrice: p.discountedPrice,
      hasRecentCartDemand: false,
    }));
  }

  /**
   * Single bounded query: which candidate product IDs appear in recent carts.
   */
  private async loadRecentCartDemandIds(
    productIds: number[],
    now: Date,
  ): Promise<Set<number>> {
    if (!productIds.length) {
      return new Set();
    }
    const since = new Date(now.getTime() - this.config.cartDemandLookbackMs);
    const rows = await this.cartItemRepository
      .createQueryBuilder('cart_item')
      .select('cart_item.productId', 'productId')
      .distinct(true)
      .where('cart_item.productId IN (:...ids)', { ids: productIds })
      .andWhere('cart_item.updatedAt >= :since', { since })
      .getRawMany<{ productId: number | string }>();

    const demand = new Set<number>();
    for (const row of rows) {
      const id = Number(row.productId);
      if (Number.isFinite(id)) demand.add(id);
    }
    return demand;
  }

  private async loadActiveCatalogPressure(sources: string[]): Promise<{
    dedupKeys: Set<string>;
    activeCountBySource: Map<string, number>;
  }> {
    const uniqueSources = [...new Set(sources)].slice(0, 50);
    if (!uniqueSources.length) {
      return { dedupKeys: new Set(), activeCountBySource: new Map() };
    }

    const jobs = await this.jobRepository.find({
      where: {
        source: In(uniqueSources),
        status: In(ACTIVE_MARKETPLACE_IMPORT_JOB_STATUSES),
      },
      select: ['source', 'sourceProductId', 'activeDedupKey'],
      take: 5000,
    });

    const dedupKeys = new Set<string>();
    const activeCountBySource = new Map<string, number>();
    for (const job of jobs) {
      dedupKeys.add(`${job.source}:${job.sourceProductId}`);
      if (job.activeDedupKey) dedupKeys.add(job.activeDedupKey);
      activeCountBySource.set(
        job.source,
        (activeCountBySource.get(job.source) || 0) + 1,
      );
    }
    return { dedupKeys, activeCountBySource };
  }

  private async loadCheckpointSnapshot(
    scopeKey: string,
  ): Promise<CatalogRefreshCheckpointSnapshot> {
    const row = await this.checkpointRepository.findOne({
      where: { scopeKey },
      select: ['scopeKey', 'afterProductId', 'revision'],
    });
    if (!row) {
      return { afterProductId: 0, revision: 0 };
    }
    const after = Number(row.afterProductId);
    const rev = Number(row.revision);
    return {
      afterProductId:
        Number.isFinite(after) && after > 0 ? Math.floor(after) : 0,
      revision: Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 0,
    };
  }

  /**
   * Revision-based compare-and-set checkpoint update (ABA-safe).
   * afterProductId equality alone NEVER authorizes a commit.
   */
  private async commitCheckpointForwardOnly(
    scopeKey: string,
    expectedAfterProductId: number,
    expectedRevision: number,
    proposedNext: number,
  ): Promise<{ committed: boolean; newRevision: number | null }> {
    const next = Math.max(0, Math.floor(proposedNext));
    const expectedCursor = Math.max(0, Math.floor(expectedAfterProductId));
    const expectedRev = Math.max(0, Math.floor(expectedRevision));

    const existing = await this.checkpointRepository.findOne({
      where: { scopeKey },
      select: ['scopeKey', 'afterProductId', 'revision'],
    });

    if (!existing) {
      if (expectedRev !== 0 || expectedCursor !== 0) {
        return { committed: false, newRevision: null };
      }
      try {
        await this.checkpointRepository.insert({
          scopeKey,
          afterProductId: next,
          revision: 1,
        });
        return { committed: true, newRevision: 1 };
      } catch (error) {
        if (isMysqlDuplicateKeyError(error)) {
          // Another concurrent initializer won — do not overwrite.
          return { committed: false, newRevision: null };
        }
        throw error;
      }
    }

    const currentRev = Number(existing.revision);
    const currentRevN = Number.isFinite(currentRev)
      ? Math.floor(currentRev)
      : 0;
    if (currentRevN !== expectedRev) {
      return { committed: false, newRevision: null };
    }

    // Defensive invariant: cursor should still match what we read.
    const currentCursor = Number(existing.afterProductId);
    const currentCursorN = Number.isFinite(currentCursor)
      ? Math.floor(currentCursor)
      : 0;
    if (currentCursorN !== expectedCursor) {
      return { committed: false, newRevision: null };
    }

    const newRevision = expectedRev + 1;
    const result = await this.checkpointRepository
      .createQueryBuilder()
      .update(CatalogRefreshCheckpointEntity)
      .set({
        afterProductId: next,
        revision: newRevision,
      })
      .where('scopeKey = :scopeKey', { scopeKey })
      .andWhere('revision = :expectedRev', { expectedRev })
      .execute();

    if ((result.affected ?? 0) > 0) {
      return { committed: true, newRevision };
    }
    return { committed: false, newRevision: null };
  }
}
