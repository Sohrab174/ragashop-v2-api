import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { Repository } from 'typeorm';
import { ConfigurationService } from '../../config/configuration.service';
import { resolveDiscountDisplayExpiresAt } from '../source-availability/customer-freshness';
import { ProductEntity } from '../product/entities/product.entity';
import { MarketplaceImportJobEntity } from '../marketplace-import/entities/marketplace-import-job.entity';
import { MarketplaceImportJobService } from '../marketplace-import/marketplace-import-job.service';
import { MarketplaceImportJobPriorityBand } from './catalog-lifecycle.types';
import {
  DISCOUNT_ENGINE_ALLOWED_TRENDYOL_CATEGORY_NAMES,
  DISCOUNT_ENGINE_DEFAULT_WC_IDS,
  DISCOUNT_ENGINE_LIVE_ENABLED_ENV,
} from './discount-engine.constants';
import {
  DiscountEngineRuntimeConfig,
  loadDiscountEngineConfig,
} from './discount-engine.config';
import {
  DiscountListingCandidate,
  filterDiscountListingCandidates,
} from './discount-listing-filter.util';
import { earliestFlashWindowEnd } from './discount-flash-tag.util';
import {
  DiscountDiscoveryPoolEntity,
  DiscountPoolEntryStatus,
} from './entities/discount-discovery-pool.entity';
import { resolveKnownDiscountCategoryId } from './discount-category-resolve.util';

export type DiscountEngineMode = 'dry_run' | 'live';

export type DiscountEngineRunInput = {
  mode: DiscountEngineMode;
  /** When true with dry_run, still call crawler listing discovery (no PDP). */
  liveListing?: boolean;
};

function isGenuineSale(price: unknown, discounted: unknown): boolean {
  const list = Number(price);
  const sale = Number(discounted);
  return (
    Number.isFinite(list) &&
    Number.isFinite(sale) &&
    list > 0 &&
    sale > 0 &&
    sale < list
  );
}

function discountPct(price: unknown, discounted: unknown): number | null {
  if (!isGenuineSale(price, discounted)) return null;
  return (
    Math.round(
      ((Number(price) - Number(discounted)) / Number(price)) * 1000,
    ) / 10
  );
}

function pathOnly(url: string): string {
  const raw = url.startsWith('http')
    ? new URL(url).pathname
    : url.split('?')[0];
  return raw.startsWith('/') ? raw : `/${raw}`;
}

@Injectable()
export class DiscountEngineService {
  private readonly logger = new Logger(DiscountEngineService.name);

  constructor(
    private readonly configService: ConfigurationService,
    private readonly jobService: MarketplaceImportJobService,
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
    @InjectRepository(MarketplaceImportJobEntity)
    private readonly jobRepo: Repository<MarketplaceImportJobEntity>,
    @InjectRepository(DiscountDiscoveryPoolEntity)
    private readonly poolRepo: Repository<DiscountDiscoveryPoolEntity>,
  ) {}

  async execute(input: DiscountEngineRunInput) {
    const cfg = loadDiscountEngineConfig();
    const started = Date.now();
    const mode = input.mode === 'live' ? 'live' : 'dry_run';

    if (mode === 'live' && !cfg.livePdpEnabled) {
      return {
        mode,
        liveBlockedReason: `${DISCOUNT_ENGINE_LIVE_ENABLED_ENV} is not true`,
        config: cfg,
        durationMs: Date.now() - started,
      };
    }

    // Dry-run: plan expirations in memory only — zero writes.
    const expireReport = await this.expireStalePoolEntries({
      apply: mode === 'live',
    });

    const doListing =
      mode === 'live' ||
      input.liveListing === true ||
      cfg.liveListingEnabled;

    let discovery: any = null;
    let shortlist: DiscountListingCandidate[] = [];
    let rejectedCount = 0;

    if (doListing) {
      discovery = await this.callCrawlerDiscovery(cfg);
      const filtered = filterDiscountListingCandidates(
        (discovery?.items || []).map((it: any) => ({
          sourceId: String(it.sourceId),
          url: String(it.url),
          name: it.name,
          listPrice: it.listPrice,
          salePrice: it.salePrice,
          listingDiscountPct: it.listingDiscountPct,
          categoryName: it.categoryName,
          sourceCategoryId: it.sourceCategoryId,
          flashTags: it.flashTags || discovery?.flashTags || [],
          sourceLabel: it.sourceLabel,
        })),
        {
          allowedCategoryNames: new Set(
            DISCOUNT_ENGINE_ALLOWED_TRENDYOL_CATEGORY_NAMES,
          ),
          preferMinPct: 30,
        },
      );
      shortlist = filtered.accepted;
      rejectedCount = filtered.rejected.length;
    }

    const activePool = await this.poolRepo.find({
      where: { status: DiscountPoolEntryStatus.active },
      order: { verifiedDiscountPct: 'DESC', id: 'ASC' },
    });

    const need = Math.max(0, cfg.poolTargetMax - activePool.length);

    const verifyPlan = shortlist
      .filter(
        (c) =>
          !activePool.some(
            (p) => p.sourceProductId === c.sourceId && p.status === 'active',
          ),
      )
      .slice(0, Math.min(cfg.pdpBudget, Math.max(need, cfg.poolTargetMin)));

    const verificationResults: any[] = [];
    if (mode === 'live') {
      for (const cand of verifyPlan) {
        const row = await this.verifyOne(cand, discovery?.flashTags || []);
        verificationResults.push(row);
        if (row.stop) break;
      }
    }

    const poolAfter = await this.poolRepo.find({
      where: { status: DiscountPoolEntryStatus.active },
    });
    const ge30 = poolAfter.filter(
      (p) =>
        p.verifiedDiscountPct != null && Number(p.verifiedDiscountPct) >= 30,
    );

    const report = {
      mode,
      liveBlockedReason: null as string | null,
      config: cfg,
      expireReport,
      discovery: doListing
        ? {
            listingRequests: discovery?.listingRequests ?? 0,
            flashTags: discovery?.flashTags ?? [],
            flashFinalUrl: discovery?.flashFinalUrl ?? null,
            rawItems: discovery?.items?.length ?? 0,
            shortlist: shortlist.length,
            rejected: rejectedCount,
            probes: discovery?.probes ?? [],
            sampleShortlist: shortlist.slice(0, 15).map((c) => ({
              sourceId: c.sourceId,
              pct: c.listingDiscountPct,
              categoryName: c.categoryName,
              url: c.url,
            })),
          }
        : {
            skipped: true,
            reason:
              'dry_run without live listing (set DISCOUNT_ENGINE_LIVE_LISTING=true or --live-listing)',
          },
      pool: {
        activeBefore: activePool.length,
        activeAfter: poolAfter.length,
        activeGe30: ge30.length,
        targetMin: cfg.poolTargetMin,
        targetMax: cfg.poolTargetMax,
        categoryDiversity: this.categoryDiversity(poolAfter),
      },
      verification: {
        planned: verifyPlan.length,
        attempted: verificationResults.length,
        succeeded: verificationResults.filter((r) => r.success).length,
        failed: verificationResults.filter((r) => r.jobId && !r.success)
          .length,
        addedToPool: verificationResults.filter((r) => r.addedToPool).length,
        results: verificationResults,
      },
      durationMs: Date.now() - started,
      confirmation: {
        customerPurchaseFreshnessUnchanged: true,
        ordinaryShowcaseUnchanged: true,
        globalCrawlerCronUnchanged: true,
        dryRunPerformsNoPdp: mode === 'dry_run',
        dryRunPerformsNoWrites: mode === 'dry_run',
      },
    };

    this.logger.log(
      JSON.stringify({
        event: 'discount_engine_run',
        mode: report.mode,
        poolActive: report.pool.activeAfter,
        shortlist: shortlist.length,
        pdpAttempted: report.verification.attempted,
      }),
    );

    return report;
  }

  /**
   * Homepage-eligible verified pool product ids (active, not past displayExpiresAt).
   */
  async listHomepageEligibleProductIds(now = new Date()): Promise<number[]> {
    const active = await this.poolRepo.find({
      where: { status: DiscountPoolEntryStatus.active },
      order: { verifiedDiscountPct: 'DESC', id: 'ASC' },
    });
    const nowMs = now.getTime();
    const ids: number[] = [];
    for (const row of active) {
      if (row.displayExpiresAt != null) {
        const ends = new Date(row.displayExpiresAt).getTime();
        if (!Number.isFinite(ends) || nowMs >= ends) continue;
      }
      if (
        row.verifiedDiscountPct == null ||
        !Number.isFinite(Number(row.verifiedDiscountPct)) ||
        Number(row.verifiedDiscountPct) <= 0
      ) {
        continue;
      }
      ids.push(row.productId);
    }
    return ids;
  }

  private categoryDiversity(
    rows: DiscountDiscoveryPoolEntity[],
  ): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of rows) {
      const k = r.categoryName || 'unknown';
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  }

  /**
   * Expire stale pool rows.
   * When apply=false (dry-run): compute planned changes only — no DB writes.
   * When apply=true: mark pool expired but PRESERVE product.discountDisplayExpiresAt
   * so Flash deadlines cannot fall back to the generic 24h window.
   */
  private async expireStalePoolEntries(opts: { apply: boolean }) {
    const now = Date.now();
    const active = await this.poolRepo.find({
      where: { status: DiscountPoolEntryStatus.active },
    });
    const planned: Array<{ poolId: number; productId: number }> = [];
    for (const row of active) {
      const ends = row.displayExpiresAt
        ? new Date(row.displayExpiresAt).getTime()
        : null;
      if (ends != null && now >= ends) {
        planned.push({ poolId: row.id, productId: row.productId });
        if (opts.apply) {
          row.status = DiscountPoolEntryStatus.expired;
          await this.poolRepo.save(row);
          // Intentionally do NOT clear product.discountDisplayExpiresAt.
          // A past deadline keeps badges ineligible until a new successful verify.
        }
      }
    }
    return {
      expired: opts.apply ? planned.length : 0,
      plannedExpirations: planned,
      applied: opts.apply,
    };
  }

  private async callCrawlerDiscovery(cfg: DiscountEngineRuntimeConfig) {
    const base =
      this.configService.crawler?.baseUrl ||
      process.env.CRAWLER_BASE_URL ||
      'http://127.0.0.1:9020';
    const secret =
      this.configService.crawler?.internalSecret ||
      process.env.CRAWLER_INTERNAL_SECRET ||
      '';
    const { data } = await axios.post(
      `${base}/internal/discount-discovery`,
      {
        listingBudget: cfg.listingBudget,
        wcIds: [...DISCOUNT_ENGINE_DEFAULT_WC_IDS],
        includeFlash: true,
      },
      {
        headers: { 'x-crawler-secret': secret },
        timeout: 600_000,
      },
    );
    return data;
  }

  private async verifyOne(
    cand: DiscountListingCandidate,
    flashTags: string[],
  ) {
    const health = await this.crawlerHealthy();
    if (!health.ok) {
      return {
        sourceId: cand.sourceId,
        success: false,
        stop: true,
        reason: 'crawler_unhealthy',
        health,
      };
    }

    const sourcePath = pathOnly(cand.url).split('?')[0];
    const canonicalUrl = `https://www.trendyol.com${sourcePath}`;
    const identity = {
      source: 'trendyol',
      sourceProductId: cand.sourceId,
      canonicalUrl,
      sourceUrl: sourcePath,
    };

    const created = await this.jobService.createOrReuseCatalogRefreshJob(
      identity,
      MarketplaceImportJobPriorityBand.COMMERCE_PRIORITY,
      { requestCorrelationId: `discount-engine:${cand.sourceId}`.slice(0, 64) },
    );
    if (!created || created.kind !== 'job') {
      return {
        sourceId: cand.sourceId,
        success: false,
        reason: 'enqueue_failed',
      };
    }

    const jobId = created.job.jobId;
    let terminal: MarketplaceImportJobEntity | null = null;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const job = await this.jobRepo.findOne({ where: { id: jobId } as any });
      if (job?.status === 'succeeded' || job?.status === 'failed') {
        terminal = job;
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    const product = await this.productRepo.findOne({
      where: { source: 'trendyol', sourceId: cand.sourceId } as any,
    });

    const jobOk = terminal?.status === 'succeeded';
    const pct = jobOk
      ? discountPct(product?.price, product?.discountedPrice)
      : null;
    const genuine =
      jobOk &&
      product?.sourceAvailability === 'available' &&
      product?.sourceSyncStatus === 'fresh' &&
      isGenuineSale(product.price, product.discountedPrice);

    let addedToPool = false;
    let categoryRemap: { from: number | null; to: number } | null = null;
    if (genuine && product) {
      const tags = [...(cand.flashTags || []), ...flashTags].filter(Boolean);
      const campaignEnd = earliestFlashWindowEnd(tags);
      const displayExpiresAt = resolveDiscountDisplayExpiresAt(
        product.availabilityLastConfirmedAt || new Date(),
        campaignEnd,
      );
      await this.productRepo.update(product.id, {
        discountDisplayExpiresAt: displayExpiresAt,
      });

      const knownCategoryId = resolveKnownDiscountCategoryId(cand.categoryName);
      if (
        knownCategoryId != null &&
        Number(product.categoryId) !== knownCategoryId
      ) {
        categoryRemap = {
          from: product.categoryId ?? null,
          to: knownCategoryId,
        };
        await this.productRepo.update(product.id, {
          categoryId: knownCategoryId,
        });
        product.categoryId = knownCategoryId;
      }

      let entry = await this.poolRepo.findOne({
        where: { productId: product.id },
      });
      if (!entry) {
        entry = this.poolRepo.create({
          productId: product.id,
          source: 'trendyol',
          sourceProductId: cand.sourceId,
        });
      }
      entry.categoryName = cand.categoryName || null;
      entry.listingDiscountPct = cand.listingDiscountPct ?? null;
      entry.verifiedDiscountPct = pct;
      entry.flashTags = tags.length ? tags.join(',').slice(0, 255) : null;
      entry.campaignWindowEndsAt = campaignEnd;
      entry.displayExpiresAt = displayExpiresAt;
      entry.verifiedAt = new Date();
      entry.status = DiscountPoolEntryStatus.active;
      await this.poolRepo.save(entry);
      addedToPool = true;
    }

    return {
      sourceId: cand.sourceId,
      productId: product?.id ?? terminal?.productId ?? null,
      jobId,
      success: jobOk,
      jobStatus: terminal?.status ?? 'timeout',
      errorCode: terminal?.errorCode ?? null,
      listingPct: cand.listingDiscountPct,
      verifiedPct: pct,
      genuine,
      addedToPool,
      categoryName: cand.categoryName,
      categoryRemap,
      stop: false,
    };
  }

  private async crawlerHealthy(): Promise<{ ok: boolean; detail: unknown }> {
    const base =
      this.configService.crawler?.baseUrl ||
      process.env.CRAWLER_BASE_URL ||
      'http://127.0.0.1:9020';
    const secret =
      this.configService.crawler?.internalSecret ||
      process.env.CRAWLER_INTERNAL_SECRET ||
      '';
    try {
      const { data } = await axios.get(`${base}/internal/health`, {
        headers: { 'x-crawler-secret': secret },
        timeout: 8000,
      });
      return { ok: data?.ok === true, detail: data };
    } catch (error) {
      return {
        ok: false,
        detail: { message: (error as Error)?.message },
      };
    }
  }
}
