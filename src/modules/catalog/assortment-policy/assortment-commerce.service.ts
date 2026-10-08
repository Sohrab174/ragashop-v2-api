import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CategoryAssortmentResolutionEntity } from './entities/category-assortment-resolution.entity';
import {
  AssortmentCommerceDecision,
  evaluateAssortmentCommerceGate,
  isAssortmentCommerceEnforcementEnabled,
} from './assortment-enforcement';
import {
  assortmentReasonLabelFa,
  assortmentStatusLabelFa,
} from './assortment-policy.labels';

/**
 * Server-side assortment commerce lookups for Cart / Checkout / paste-link.
 * Does not trust client-supplied status.
 */
@Injectable()
export class AssortmentCommerceService {
  constructor(
    @InjectRepository(CategoryAssortmentResolutionEntity)
    private readonly resolutionRepository: Repository<CategoryAssortmentResolutionEntity>,
  ) {}

  async getStatusForCategory(
    categoryId: number | null | undefined,
  ): Promise<string | null> {
    if (categoryId == null || !(Number(categoryId) > 0)) return null;
    const row = await this.resolutionRepository.findOne({
      where: { categoryId: Number(categoryId) },
      select: ['status'],
    });
    return row?.status ?? null;
  }

  async getStatusMapForCategories(
    categoryIds: number[],
  ): Promise<Map<number, string>> {
    const ids = [
      ...new Set(
        categoryIds.filter((id) => Number.isInteger(id) && id > 0).map(Number),
      ),
    ];
    const map = new Map<number, string>();
    if (!ids.length) return map;
    const rows = await this.resolutionRepository.find({
      where: { categoryId: In(ids) },
      select: ['categoryId', 'status'],
    });
    for (const r of rows) {
      map.set(Number(r.categoryId), String(r.status));
    }
    return map;
  }

  async evaluateForCategory(
    categoryId: number | null | undefined,
  ): Promise<AssortmentCommerceDecision> {
    const status = await this.getStatusForCategory(categoryId);
    return evaluateAssortmentCommerceGate(status);
  }

  /**
   * SCOPE-5/6 — Admin read-only view of customer paste-link requests whose
   * product category is not IN_SCOPE (review evidence). One row per source
   * product (idempotent across repeated pastes). No customer PII.
   * Reuses marketplace_import_job + product + category + resolution (no migration).
   */
  async listPasteLinkReviewRequestsAdmin(input: {
    status?: string | null;
    limit?: number;
  }): Promise<{
    items: Array<{
      productId: number;
      provider: string;
      sourceProductId: string;
      sourceUrl: string;
      sourceCategoryId: number | null;
      sourceCategoryName: string | null;
      assortmentStatus: string | null;
      assortmentStatusLabel: string;
      reasonLabel: string;
      reviewState: 'pending_decision' | 'unavailable' | 'eligible_now';
      reviewStateLabel: string;
      requestCount: number;
      firstRequestedAt: string | null;
      lastRequestedAt: string | null;
    }>;
    total: number;
  }> {
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
    const statusFilter = input.status || null;
    const params: unknown[] = [];
    let statusSql = `(r.status IS NULL OR r.status <> 'IN_SCOPE')`;
    if (statusFilter === 'REVIEW_REQUIRED') {
      statusSql = `(r.status IS NULL OR r.status = 'REVIEW_REQUIRED')`;
    } else if (statusFilter === 'OUT_OF_SCOPE') {
      statusSql = `r.status = 'OUT_OF_SCOPE'`;
    } else if (statusFilter === 'ALL') {
      statusSql = '1 = 1';
    }
    const rows: any[] = await this.resolutionRepository.manager.query(
      `SELECT p.id AS productId,
              j.source AS provider,
              j.sourceProductId AS sourceProductId,
              MAX(j.canonicalSourceUrl) AS sourceUrl,
              p.categoryId AS sourceCategoryId,
              c.name AS sourceCategoryName,
              r.status AS assortmentStatus,
              r.reasonCode AS reasonCode,
              COUNT(j.id) AS requestCount,
              MIN(j.createdAt) AS firstRequestedAt,
              MAX(j.createdAt) AS lastRequestedAt
         FROM marketplace_import_job j
         JOIN product p ON p.id = j.productId
         LEFT JOIN category c ON c.id = p.categoryId
         LEFT JOIN category_assortment_resolution r ON r.categoryId = p.categoryId
        WHERE j.requestType = 'customer'
          AND ${statusSql}
        GROUP BY p.id, j.source, j.sourceProductId, p.categoryId, c.name, r.status, r.reasonCode
        ORDER BY lastRequestedAt DESC
        LIMIT ${limit}`,
      params,
    );
    const items = rows.map((row) => {
      const status = row.assortmentStatus ?? null;
      const reviewState: 'pending_decision' | 'unavailable' | 'eligible_now' =
        status === 'IN_SCOPE'
          ? 'eligible_now'
          : status === 'OUT_OF_SCOPE'
          ? 'unavailable'
          : 'pending_decision';
      return {
        productId: Number(row.productId),
        provider: String(row.provider),
        sourceProductId: String(row.sourceProductId),
        sourceUrl: String(row.sourceUrl),
        sourceCategoryId:
          row.sourceCategoryId != null ? Number(row.sourceCategoryId) : null,
        sourceCategoryName: row.sourceCategoryName ?? null,
        assortmentStatus: status,
        assortmentStatusLabel: status
          ? assortmentStatusLabelFa(status)
          : 'هنوز تصمیم‌گیری نشده',
        reasonLabel: assortmentReasonLabelFa(row.reasonCode),
        reviewState,
        reviewStateLabel:
          reviewState === 'eligible_now'
            ? 'قابل سفارش'
            : reviewState === 'unavailable'
            ? 'غیرقابل سفارش'
            : 'در انتظار تصمیم',
        requestCount: Number(row.requestCount) || 0,
        firstRequestedAt: row.firstRequestedAt
          ? new Date(row.firstRequestedAt).toISOString()
          : null,
        lastRequestedAt: row.lastRequestedAt
          ? new Date(row.lastRequestedAt).toISOString()
          : null,
      };
    });
    return { items, total: items.length };
  }

  /**
   * When commerce enforcement is on, returns a blocking decision if not purchasable.
   * When off, returns null (shadow / observe).
   */
  async assertPurchasableOrDecision(
    categoryId: number | null | undefined,
  ): Promise<AssortmentCommerceDecision | null> {
    if (!isAssortmentCommerceEnforcementEnabled()) return null;
    const decision = await this.evaluateForCategory(categoryId);
    return decision.purchasable ? null : decision;
  }
}
