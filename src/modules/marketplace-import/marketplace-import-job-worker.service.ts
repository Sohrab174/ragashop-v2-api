import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ProductEntity,
  ProductStatus,
} from '../product/entities/product.entity';
import {
  membershipPatchForCustomerImportSuccess,
  membershipPatchForScheduledImportSuccess,
} from '../catalog-lifecycle/catalog-membership.util';
import { ProductSupplyType } from '../catalog-lifecycle/catalog-lifecycle.types';
import { CrawlerClientService } from './crawler-client.service';
import { MarketplaceImportConcurrencyGate } from './marketplace-import-concurrency';
import { MarketplaceImportJobService } from './marketplace-import-job.service';
import {
  MarketplaceSourceIdentity,
  toCanonicalMarketplaceIdentity,
} from './marketplace-source-identity.util';
import { sourcePathFromCanonicalUrl } from './marketplace-url.validator';
import { loadHighIntentRefreshPolicy } from './high-intent-refresh.config';
import { shouldHighIntentRefresh } from './high-intent-refresh.policy';
import { SourceCommercialAvailability } from '../source-availability';

@Injectable()
export class MarketplaceImportJobWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MarketplaceImportJobWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly inFlight = new Set<Promise<void>>();
  /** Full claim lifecycle: acquire → shutdown check → process OR release → settle. */
  private readonly claimLifecycles = new Set<Promise<unknown>>();
  private shuttingDown = false;
  private readonly highIntentPolicy = loadHighIntentRefreshPolicy();

  constructor(
    private readonly jobService: MarketplaceImportJobService,
    private readonly crawlerClient: CrawlerClientService,
    private readonly concurrencyGate: MarketplaceImportConcurrencyGate,
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
  ) {}

  onModuleInit(): void {
    if (!this.jobService.isWorkerEnabled()) {
      this.logger.log('Marketplace import job worker disabled');
      return;
    }

    const intervalMs = this.jobService.getPollIntervalMs();
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.logger.log(
      `Marketplace import job worker started (poll=${intervalMs}ms)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Drain until tick exits and every claim lifecycle (including delayed release) settles.
    // Loop so a lifecycle added after the first snapshot cannot outlive destroy.
    for (;;) {
      const pending = [...this.inFlight, ...this.claimLifecycles];
      if (!this.running && pending.length === 0) {
        break;
      }
      if (pending.length > 0) {
        await Promise.allSettled(pending);
      } else {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  }

  async tick(): Promise<void> {
    if (this.running || this.shuttingDown) {
      return;
    }

    this.running = true;
    try {
      await this.jobService.recoverExpiredClaims();

      const capacity = this.concurrencyGate.getMaxConcurrent();

      while (!this.shuttingDown) {
        while (!this.shuttingDown && this.inFlight.size < capacity) {
          const lifecycle = this.beginClaimLifecycle();
          this.claimLifecycles.add(lifecycle);
          let claimed: Awaited<typeof lifecycle> = null;
          try {
            claimed = await lifecycle;
          } finally {
            this.claimLifecycles.delete(lifecycle);
          }

          if (!claimed) {
            break;
          }

          const jobPromise = this.processClaimedJob(
            claimed.job.id,
            claimed.claimToken,
          )
            .catch((error) => {
              this.logger.error(
                `Marketplace import job ${claimed.job.id} failed unexpectedly`,
                error,
              );
            })
            .finally(() => {
              this.inFlight.delete(jobPromise);
            });

          this.inFlight.add(jobPromise);
        }

        if (this.shuttingDown || this.inFlight.size === 0) {
          break;
        }

        await Promise.race([...this.inFlight]);
      }

      await Promise.allSettled([...this.inFlight]);
    } catch (error) {
      this.logger.error('Marketplace import worker tick failed', error);
    } finally {
      this.running = false;
    }
  }

  /**
   * Tracks claim acquisition through either normal handoff or shutdown release.
   * Destroy must await this promise so delayed release cannot outlive shutdown.
   */
  private beginClaimLifecycle(): Promise<{
    job: { id: number };
    claimToken: string;
  } | null> {
    return (async () => {
      const claimed = await this.jobService.claimNextEligibleJob();
      if (this.shuttingDown) {
        if (claimed) {
          await this.jobService.releaseClaimForShutdown(
            claimed.job.id,
            claimed.claimToken,
          );
        }
        return null;
      }
      return claimed;
    })();
  }

  async processClaimedJob(jobId: number, claimToken: string): Promise<void> {
    if (this.shuttingDown) {
      await this.jobService.releaseClaimForShutdown(jobId, claimToken);
      return;
    }

    const job = await this.jobService.getProcessingJob(jobId, claimToken);
    if (!job) {
      return;
    }

    const sourceUrl = sourcePathFromCanonicalUrl(job.canonicalSourceUrl);
    const identity: MarketplaceSourceIdentity = {
      source: job.source,
      sourceProductId: job.sourceProductId,
      canonicalUrl: `https://www.trendyol.com${sourceUrl}`,
      sourceUrl,
    };

    const existingProduct = await this.findExistingActiveProduct(identity);
    if (existingProduct) {
      // A5 scheduled refresh already decided freshness is due — do not apply
      // A6 high-intent 24h skip (that would starve HOT/WARM adaptive cadences).
      // Still honor REMOVED / native no-crawl semantics.
      const isScheduledCatalogRefresh = job.requestType === 'scheduled';
      if (isScheduledCatalogRefresh) {
        const nativeSkip =
          existingProduct.supplyType === ProductSupplyType.native_marketplace;
        const removedSkip =
          existingProduct.sourceAvailability ===
          SourceCommercialAvailability.removed;
        this.logger.log(
          JSON.stringify({
            event: 'catalog_refresh_scheduled_decision',
            source: identity.source,
            sourceProductId: identity.sourceProductId,
            productId: existingProduct.id,
            refresh: !nativeSkip && !removedSkip,
            reason: nativeSkip
              ? 'native_no_refresh'
              : removedSkip
                ? 'removed_no_refresh'
                : 'scheduled_force_refresh',
            phase: 'worker',
          }),
        );
        if (nativeSkip || removedSkip) {
          await this.jobService.markJobFailed(
            jobId,
            claimToken,
            removedSkip ? 'SOURCE_UNAVAILABLE' : 'UNSUPPORTED_SUPPLY',
            removedSkip ? 'محصولی یافت نشد!' : 'Native inventory is not crawl-refreshed',
            false,
          );
          return;
        }
      } else {
        const decision = shouldHighIntentRefresh(
          existingProduct,
          new Date(),
          this.highIntentPolicy,
        );
        this.logger.log(
          JSON.stringify({
            event: 'marketplace_import_high_intent_decision',
            source: identity.source,
            sourceProductId: identity.sourceProductId,
            productId: existingProduct.id,
            refresh: decision.refresh,
            reason: decision.reason,
            phase: 'worker',
          }),
        );
        if (!decision.refresh) {
          const reconciled = await this.jobService.reconcileSucceededProduct(
            jobId,
            claimToken,
            existingProduct.id,
          );
          if (reconciled) {
            this.logger.log(
              `Reconciled marketplace import job ${jobId} to existing product ${existingProduct.id}`,
            );
          }
          return;
        }
      }
    } else {
      const tombstone = await this.findRemovedTombstone(identity);
      if (tombstone) {
        this.logger.log(
          JSON.stringify({
            event: 'marketplace_import_high_intent_decision',
            source: identity.source,
            sourceProductId: identity.sourceProductId,
            productId: tombstone.id,
            refresh: false,
            reason: 'removed_no_refresh',
            phase: 'worker',
          }),
        );
        await this.jobService.markJobFailed(
          jobId,
          claimToken,
          'SOURCE_UNAVAILABLE',
          'محصولی یافت نشد!',
          false,
        );
        return;
      }
    }

    let permit: { release: () => void } | null = null;
    try {
      permit = await this.concurrencyGate.acquire();
      if (this.shuttingDown) {
        await this.jobService.releaseClaimForShutdown(jobId, claimToken);
        return;
      }
      const crawlerIdentity = toCanonicalMarketplaceIdentity(identity);
      const result = await this.crawlerClient.importProduct(crawlerIdentity);

      if (!result?.id || !result?.name) {
        throw Object.assign(new Error('Invalid crawler response'), {
          code: 'INVALID_CRAWLER_RESPONSE',
        });
      }

      const succeeded = await this.jobService.markJobSucceeded(
        jobId,
        claimToken,
        result.id,
      );
      if (!succeeded) {
        this.logger.warn(
          `Stale worker could not mark marketplace import job ${jobId} succeeded`,
        );
      } else {
        await this.applySupplyMembershipBestEffort(job.requestType, result.id);
      }
    } catch (error) {
      const classification = this.jobService.classifyFailure(error);
      const handled = await this.jobService.markJobFailed(
        jobId,
        claimToken,
        classification.errorCode,
        classification.errorMessage,
        classification.kind === 'retryable',
      );
      if (!handled) {
        this.logger.warn(
          `Stale worker could not mark marketplace import job ${jobId} failed`,
        );
      }
    } finally {
      permit?.release();
    }
  }

  private async findExistingActiveProduct(
    identity: MarketplaceSourceIdentity,
  ): Promise<{
    id: number;
    name: string;
    supplyType: string;
    sourceAvailability: string;
    sourceSyncStatus: string;
    availabilityLastConfirmedAt: Date | null;
  } | null> {
    const bySource = await this.productRepository
      .createQueryBuilder('product')
      .select([
        'product.id',
        'product.name',
        'product.supplyType',
        'product.sourceAvailability',
        'product.sourceSyncStatus',
        'product.availabilityLastConfirmedAt',
      ])
      .where('product.source = :source', { source: identity.source })
      .andWhere('product.sourceId = :sourceId', {
        sourceId: identity.sourceProductId,
      })
      .andWhere('product.categoryId != 1')
      .andWhere('product.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('product.status = :status', { status: ProductStatus.active })
      .orderBy('product.id', 'ASC')
      .getOne();

    if (bySource) {
      return {
        id: bySource.id,
        name: bySource.name,
        supplyType: bySource.supplyType,
        sourceAvailability: bySource.sourceAvailability,
        sourceSyncStatus: bySource.sourceSyncStatus,
        availabilityLastConfirmedAt: bySource.availabilityLastConfirmedAt,
      };
    }

    return null;
  }

  private async findRemovedTombstone(
    identity: MarketplaceSourceIdentity,
  ): Promise<{ id: number; name: string } | null> {
    const tombstone = await this.productRepository
      .createQueryBuilder('product')
      .select(['product.id', 'product.name'])
      .where('product.source = :source', { source: identity.source })
      .andWhere('product.sourceId = :sourceId', {
        sourceId: identity.sourceProductId,
      })
      .andWhere('product.categoryId != 1')
      .andWhere('product.sourceAvailability = :removed', {
        removed: SourceCommercialAvailability.removed,
      })
      .orderBy('product.id', 'ASC')
      .getOne();

    return tombstone ? { id: tombstone.id, name: tombstone.name } : null;
  }

  private async applySupplyMembershipBestEffort(
    requestType: string,
    productId: number,
  ): Promise<void> {
    try {
      const patch =
        requestType === 'customer'
          ? membershipPatchForCustomerImportSuccess()
          : membershipPatchForScheduledImportSuccess();
      await this.productRepository.update({ id: productId }, patch as any);
    } catch (error) {
      this.logger.warn(
        `Failed to set supply membership for product ${productId}`,
        error as Error,
      );
    }
  }
}
