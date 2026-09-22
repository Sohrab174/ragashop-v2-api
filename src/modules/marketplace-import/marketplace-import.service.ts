import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import {
  ProductEntity,
  ProductStatus,
} from '../product/entities/product.entity';
import { SourceCommercialAvailability } from '../source-availability';
import { MarketplaceImportCoalescer } from './marketplace-import-coalescer';
import { MarketplaceImportJobService } from './marketplace-import-job.service';
import { MarketplaceImportJobStatus } from './marketplace-import-job.types';
import { MarketplaceImportRateLimiter } from './marketplace-import-rate-limiter';
import {
  CanonicalMarketplaceIdentity,
  MarketplaceUrlValidationError,
  validateInitialMarketplaceUrl,
} from './marketplace-url.validator';
import {
  MarketplaceRedirectError,
  MarketplaceRedirectResolver,
} from './marketplace-redirect.resolver';
import { identityFromCanonical } from './marketplace-source-identity.util';
import { MarketplaceImportCreateResult } from './marketplace-import-job.types';
import { toCustomerSafeImportError } from './marketplace-import-customer-errors';
import { loadHighIntentRefreshPolicy } from './high-intent-refresh.config';
import {
  HighIntentRefreshDecision,
  HighIntentRefreshReason,
  shouldHighIntentRefresh,
} from './high-intent-refresh.policy';

export interface MarketplaceImportSuccess {
  id: number;
  name: string;
}

export type ExistingMarketplaceProduct = {
  id: number;
  name: string;
  supplyType: string;
  sourceAvailability: string;
  sourceSyncStatus: string;
  availabilityLastConfirmedAt: Date | null;
  status: ProductStatus;
  isDeleted: boolean;
};

const EXISTING_PRODUCT_SELECT = [
  'product.id',
  'product.name',
  'product.supplyType',
  'product.sourceAvailability',
  'product.sourceSyncStatus',
  'product.availabilityLastConfirmedAt',
  'product.status',
  'product.isDeleted',
] as const;

@Injectable()
export class MarketplaceImportService {
  private readonly logger = new Logger(MarketplaceImportService.name);
  private readonly highIntentPolicy = loadHighIntentRefreshPolicy();

  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    private readonly redirectResolver: MarketplaceRedirectResolver,
    private readonly rateLimiter: MarketplaceImportRateLimiter,
    private readonly coalescer: MarketplaceImportCoalescer,
    private readonly jobService: MarketplaceImportJobService,
  ) {}

  async importFromUrl(
    rawUrl: string,
    clientIp: string,
    requestCorrelationId?: string,
  ): Promise<MarketplaceImportCreateResult> {
    if (!this.rateLimiter.isAllowed(clientIp)) {
      throw new HttpException(
        {
          success: false,
          messages: [
            'تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
          ],
          data: {},
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const identity = await this.resolveIdentity(rawUrl);
    const sourceIdentity = identityFromCanonical(identity);
    const now = new Date();

    const existing = await this.findExistingProduct(identity);
    if (existing) {
      const decision = shouldHighIntentRefresh(
        existing,
        now,
        this.highIntentPolicy,
      );
      if (!decision.refresh) {
        this.logHighIntentDecision(
          decision,
          sourceIdentity.sourceProductId,
          existing.id,
        );
        return { kind: 'product', id: existing.id, name: existing.name };
      }
    } else {
      const removed = await this.findRemovedSourceProduct(identity);
      if (removed) {
        this.logHighIntentDecision(
          { refresh: false, reason: 'removed_no_refresh' },
          sourceIdentity.sourceProductId,
          removed.id,
        );
        this.throwRemovedNoRefresh();
      }
    }

    const coalesceKey = `trendyol:${identity.sourceProductId}`;

    return this.coalescer.coalesce(coalesceKey, async () => {
      const existingAfterWait = await this.findExistingProduct(identity);
      if (existingAfterWait) {
        const decision = shouldHighIntentRefresh(
          existingAfterWait,
          new Date(),
          this.highIntentPolicy,
        );
        this.logHighIntentDecision(
          decision,
          sourceIdentity.sourceProductId,
          existingAfterWait.id,
        );
        if (!decision.refresh) {
          return {
            kind: 'product',
            id: existingAfterWait.id,
            name: existingAfterWait.name,
          };
        }
      } else {
        const removedAfterWait = await this.findRemovedSourceProduct(identity);
        if (removedAfterWait) {
          this.logHighIntentDecision(
            { refresh: false, reason: 'removed_no_refresh' },
            sourceIdentity.sourceProductId,
            removedAfterWait.id,
          );
          this.throwRemovedNoRefresh();
        }
        this.logHighIntentDecision(
          { refresh: true, reason: 'new_product_import' },
          sourceIdentity.sourceProductId,
          null,
        );
      }

      const jobResult = await this.jobService.createOrReuseCustomerJob(
        sourceIdentity,
        this.hashClientIp(clientIp),
        requestCorrelationId || null,
      );

      if (!jobResult) {
        throw new HttpException(
          {
            success: false,
            messages: ['دریافت اطلاعات محصول با خطا مواجه شد.'],
            data: {},
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      if (jobResult.kind === 'job') {
        const completed = await this.tryResolveCompletedJob(
          jobResult.job.jobId,
          identity,
        );
        if (completed) {
          return completed;
        }
      }

      return jobResult;
    });
  }

  async getJobStatus(jobId: number, accessToken: string) {
    const status = await this.jobService.getPublicJobStatus(jobId, accessToken);

    if (
      status.status === MarketplaceImportJobStatus.succeeded &&
      status.productId
    ) {
      const product = await this.productRepository.findOne({
        where: { id: status.productId },
        select: ['id', 'name'],
      });
      if (product) {
        return {
          ...status,
          productName: product.name,
        };
      }
    }

    return status;
  }

  private async tryResolveCompletedJob(
    jobId: number,
    identity: CanonicalMarketplaceIdentity,
  ): Promise<MarketplaceImportCreateResult | null> {
    const existing = await this.findExistingProduct(identity);
    if (!existing) {
      return null;
    }

    const decision = shouldHighIntentRefresh(
      existing,
      new Date(),
      this.highIntentPolicy,
    );
    if (decision.refresh) {
      return null;
    }

    this.logger.log(
      `Marketplace import job ${jobId} resolved via existing active product ${existing.id}`,
    );

    return {
      kind: 'product',
      id: existing.id,
      name: existing.name,
    };
  }

  private async resolveIdentity(
    rawUrl: string,
  ): Promise<CanonicalMarketplaceIdentity> {
    try {
      const initial = validateInitialMarketplaceUrl(rawUrl);
      if ('identity' in initial) {
        return initial.identity;
      }
      return await this.redirectResolver.resolveTyGlToIdentity(initial.url);
    } catch (error) {
      throw this.mapValidationError(error);
    }
  }

  async findExistingProduct(
    identity: CanonicalMarketplaceIdentity,
  ): Promise<ExistingMarketplaceProduct | null> {
    const product = await this.productRepository
      .createQueryBuilder('product')
      .select([...EXISTING_PRODUCT_SELECT])
      .where('product.source = :source', { source: identity.marketplace })
      .andWhere('product.sourceId = :sourceId', {
        sourceId: identity.sourceProductId,
      })
      .andWhere('product.categoryId != 1')
      .andWhere('product.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('product.status = :status', { status: ProductStatus.active })
      .orderBy('product.id', 'ASC')
      .getOne();

    if (product) {
      return this.toExistingProduct(product);
    }

    const byUrl = await this.productRepository
      .createQueryBuilder('product')
      .select([...EXISTING_PRODUCT_SELECT])
      .where('product.sourceUrl = :sourceUrl', {
        sourceUrl: identity.sourceUrl,
      })
      .andWhere('product.categoryId != 1')
      .andWhere('product.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('product.status = :status', { status: ProductStatus.active })
      .orderBy('product.id', 'ASC')
      .getOne();

    if (byUrl) {
      return this.toExistingProduct(byUrl);
    }

    return null;
  }

  /**
   * Authoritative REMOVED rows (including deleted/inactive) must not be
   * treated as new imports — that would recrawl a permanent 404/410 result.
   */
  private async findRemovedSourceProduct(
    identity: CanonicalMarketplaceIdentity,
  ): Promise<ExistingMarketplaceProduct | null> {
    const product = await this.productRepository
      .createQueryBuilder('product')
      .select([...EXISTING_PRODUCT_SELECT])
      .where('product.source = :source', { source: identity.marketplace })
      .andWhere('product.sourceId = :sourceId', {
        sourceId: identity.sourceProductId,
      })
      .andWhere('product.categoryId != 1')
      .andWhere('product.sourceAvailability = :removed', {
        removed: SourceCommercialAvailability.removed,
      })
      .orderBy('product.id', 'ASC')
      .getOne();

    return product ? this.toExistingProduct(product) : null;
  }

  private toExistingProduct(
    product: Pick<
      ProductEntity,
      | 'id'
      | 'name'
      | 'supplyType'
      | 'sourceAvailability'
      | 'sourceSyncStatus'
      | 'availabilityLastConfirmedAt'
      | 'status'
      | 'isDeleted'
    >,
  ): ExistingMarketplaceProduct {
    return {
      id: product.id,
      name: product.name,
      supplyType: product.supplyType,
      sourceAvailability: product.sourceAvailability,
      sourceSyncStatus: product.sourceSyncStatus,
      availabilityLastConfirmedAt: product.availabilityLastConfirmedAt,
      status: product.status,
      isDeleted: product.isDeleted,
    };
  }

  private throwRemovedNoRefresh(): never {
    const safe = toCustomerSafeImportError(
      'SOURCE_UNAVAILABLE',
      'محصولی یافت نشد!',
    );
    throw new HttpException(
      {
        success: false,
        messages: [safe.message],
        data: { code: safe.code },
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  private logHighIntentDecision(
    decision: HighIntentRefreshDecision,
    sourceProductId: string,
    productId: number | null,
  ): void {
    this.logger.log(
      JSON.stringify({
        event: 'marketplace_import_high_intent_decision',
        source: 'trendyol',
        sourceProductId,
        productId,
        refresh: decision.refresh,
        reason: decision.reason as HighIntentRefreshReason,
      }),
    );
  }

  private hashClientIp(clientIp: string): string {
    return crypto
      .createHash('sha256')
      .update(clientIp)
      .digest('hex')
      .slice(0, 32);
  }

  private mapValidationError(error: unknown): HttpException {
    if (error instanceof MarketplaceUrlValidationError) {
      const safe = toCustomerSafeImportError(error.code, error.message);
      return new HttpException(
        {
          success: false,
          messages: [safe.message],
          data: { code: safe.code },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (error instanceof MarketplaceRedirectError) {
      const safe = toCustomerSafeImportError(error.code, error.message);
      return new HttpException(
        {
          success: false,
          messages: [safe.message],
          data: { code: safe.code },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (error instanceof HttpException) {
      return error;
    }

    this.logger.error('Unexpected marketplace import validation error', error);
    return new HttpException(
      {
        success: false,
        messages: ['خطای غیرمنتظره‌ای رخ داده است. لطفاً دوباره تلاش کنید.'],
        data: {},
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
