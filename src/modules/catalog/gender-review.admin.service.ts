/**
 * Admin queue for products whose gender is unresolved («نیازمند تعیین جنسیت»).
 *
 * - List is limited to gender-relevant or ambiguous categories. Household,
 *   general cosmetics (including color makeup and nails), structural kids
 *   categories, confidently identified children's footwear, and confidently
 *   identified children's apparel stay out.
 * - Resolve writes only product.gender (never invents mappings, unisex, or
 *   an adult gender for a not-applicable category).
 * - Destination preview reuses the shared storefront eligibility resolver.
 * - Audit reuses assortment_policy_audit (append-only) with operation
 *   `product_gender_resolve` so no new tables/migrations are required.
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as moment from 'jalali-moment';
import { paginationResult } from '../../utils';
import { CategoryEntity } from '../category/entities/category.entity';
import { discoveryEligibilitySql } from '../product/discovery-eligibility';
import {
  ProductEntity,
  ProductStatus,
} from '../product/entities/product.entity';
import { AssortmentPolicyAuditEntity } from './assortment-policy/entities/assortment-policy-audit.entity';
import { AssortmentPolicyStateEntity } from './assortment-policy/entities/assortment-policy-state.entity';
import { buildCanonicalPath } from './cat-map-v2a-classification';
import {
  buildSourceCategoryPath,
  expandSourceCategoryScopeIds,
} from './cat-map-v2c-distribution';
import {
  loadCanonicalEligibilityData,
  resolveCanonicalProductEligibilityFromData,
} from './canonical-product-eligibility.loader';
import {
  SourceCategoryMappingEntity,
  SourceCategoryMappingStatus,
} from './entities/source-category-mapping.entity';
import {
  buildGenderDestinationPreview,
  GenderReviewScope,
  GenderReviewValidationError,
  parseGenderResolutionInput,
  parseGenderReviewScope,
  unresolvedGenderSql,
} from './gender-review.util';
import { buildGenderReviewPreviewAttributes } from './gender-review-preview.util';
import {
  classifyGenderRelevance,
  GenderRelevanceAttribute,
  GenderRelevanceDecision,
  refineGenderRelevance,
} from './gender-relevance';
import { clearStorefrontPlpFacetCache } from './storefront-plp-facet-cache';

/** Same clock format as `dateTime()`, applied to a stored instant. */
function formatStoredDateTime(value: Date): string {
  return moment(value).format('YYYY-MM-DD HH:mm:ss');
}

@Injectable()
export class GenderReviewAdminService {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoryRepository: Repository<CategoryEntity>,
    @InjectRepository(SourceCategoryMappingEntity)
    private readonly mappingRepository: Repository<SourceCategoryMappingEntity>,
  ) {}

  async getSummaryAdmin(options?: {
    scope?: string | null;
    sourceCategoryId?: number | null;
  }) {
    const scope = parseGenderReviewScope(options?.scope);
    const sourceCategoryId =
      options?.sourceCategoryId != null
        ? Number(options.sourceCategoryId)
        : null;

    const relevance = await this.loadRelevanceIndex();
    const scopeIds = await this.sourceScopeIdsOrNull(sourceCategoryId);
    if (scopeIds && !scopeIds.length) {
      return this.emptySummary(scope, sourceCategoryId);
    }
    const { footwear, apparel } = await this.loadAudienceRefinements(
      scope,
      scopeIds,
      relevance,
    );
    return this.summarizeRelevance(
      scope,
      sourceCategoryId,
      scopeIds,
      relevance,
      footwear,
      apparel,
    );
  }

  async listQueueAdmin(options?: {
    page?: number;
    limit?: number;
    scope?: string | null;
    sourceCategoryId?: number | null;
    q?: string | null;
  }) {
    const page = Math.max(Number(options?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(options?.limit) || 30, 1), 100);
    const scope = parseGenderReviewScope(options?.scope);
    const sourceCategoryId =
      options?.sourceCategoryId != null
        ? Number(options.sourceCategoryId)
        : null;
    const q = options?.q ? String(options.q).trim() : '';

    const relevance = await this.loadRelevanceIndex();
    const scopeIds = await this.sourceScopeIdsOrNull(sourceCategoryId);
    if (scopeIds && !scopeIds.length) {
      return {
        items: [],
        pagination: paginationResult(page, limit, 0),
        summary: this.emptySummary(scope, sourceCategoryId),
      };
    }
    const { footwear, apparel } = await this.loadAudienceRefinements(
      scope,
      scopeIds,
      relevance,
    );
    const hiddenChildFootwearIds = [...footwear.entries()]
      .filter(([, decision]) => !decision.reviewable)
      .map(([id]) => id);
    const hiddenChildApparelIds = [...apparel.entries()]
      .filter(([, decision]) => !decision.reviewable)
      .map(([id]) => id);

    const qb = this.baseReviewableQb(scope, relevance)
      .leftJoinAndSelect('p.cover', 'cover')
      .leftJoinAndSelect('p.category', 'category')
      .orderBy('p.id', 'DESC');
    if (hiddenChildFootwearIds.length) {
      qb.andWhere('p.id NOT IN (:...hiddenChildFootwearIds)', {
        hiddenChildFootwearIds,
      });
    }
    if (hiddenChildApparelIds.length) {
      qb.andWhere('p.id NOT IN (:...hiddenChildApparelIds)', {
        hiddenChildApparelIds,
      });
    }

    if (scopeIds) {
      qb.andWhere('p.categoryId IN (:...scopeIds)', { scopeIds });
    }

    if (q) {
      qb.andWhere(
        '(p.name LIKE :q OR p.sourceName LIKE :q OR p.number LIKE :q OR CAST(p.id AS CHAR) = :qid)',
        { q: `%${q}%`, qid: q },
      );
    }

    const [rows, totalItems] = await qb
      .take(limit)
      .skip((page - 1) * limit)
      .getManyAndCount();

    const taxonomy = await this.categoryRepository.find({
      select: ['id', 'parentId', 'source', 'sourceName', 'name', 'status'],
    });

    const items = rows.map((p) => {
      const path = buildSourceCategoryPath(
        Number(p.categoryId),
        taxonomy,
        p.category?.source ?? null,
      );
      return {
        id: p.id,
        name: p.name,
        sourceName: p.sourceName,
        number: p.number,
        gender: p.gender,
        status: p.status,
        price: p.price,
        source: p.source,
        sourceUrl: p.sourceUrl,
        categoryId: p.categoryId,
        categoryName: p.category?.name ?? null,
        categorySourceName: p.category?.sourceName ?? null,
        sourceCategoryPath: path,
        sourceCategoryPathLabel: path.join(' → '),
        coverPath: p.cover?.pathFile ?? null,
        ...this.relevanceFields(
          footwear.get(Number(p.id)) ??
            apparel.get(Number(p.id)) ??
            relevance.get(Number(p.categoryId)),
          footwear.has(Number(p.id)) || apparel.has(Number(p.id))
            ? undefined
            : {
                name: p.name,
                sourceName: p.sourceName,
                ageGroup: p.ageGroup,
              },
        ),
        // ProductEntity has createdAt only; do not invent an update time.
        updatedAt: null,
        createdAt: p.createdAt ? formatStoredDateTime(p.createdAt) : null,
      };
    });

    return {
      items,
      pagination: paginationResult(page, limit, totalItems),
      summary: await this.summarizeRelevance(
        scope,
        sourceCategoryId,
        scopeIds,
        relevance,
        footwear,
        apparel,
      ),
    };
  }

  async getProductPreviewAdmin(productId: number) {
    const product = await this.productRepository.findOne({
      where: { id: productId, isDeleted: false },
      relations: ['category', 'cover'],
    });
    if (!product || product.categoryId === 1) {
      throw new GenderReviewValidationError(
        'محصول یافت نشد.',
        'not_found',
      );
    }

    const taxonomy = await this.categoryRepository.find({
      select: ['id', 'parentId', 'source', 'sourceName', 'name', 'status'],
    });
    const path = buildSourceCategoryPath(
      Number(product.categoryId),
      taxonomy,
      product.category?.source ?? null,
    );

    const destinations = await this.previewDestinationsForProduct(product);
    const relevance = await this.loadRelevanceIndex();
    const attributeRows = await this.loadGenderAttributes([Number(product.id)]);
    const attributes = attributeRows.get(Number(product.id)) ?? [];
    const previewAttributes = buildGenderReviewPreviewAttributes(attributes);
    const relevanceFields = product.gender
      ? {
          classification: String(product.gender),
          classificationLabel: String(product.gender),
          relevance: 'resolved',
          relevanceReason: 'already_assigned',
          relevanceReasonLabel: 'جنسیت این محصول قبلاً ثبت شده است',
          relevanceReasonBadge: 'تعیین‌شده',
        }
      : this.relevanceFields(relevance.get(Number(product.categoryId)), {
          name: product.name,
          sourceName: product.sourceName,
          ageGroup: product.ageGroup,
          attributes,
        });

    return {
      product: {
        id: product.id,
        name: product.name,
        sourceName: product.sourceName,
        gender: product.gender,
        status: product.status,
        categoryId: product.categoryId,
        categoryName: product.category?.name ?? null,
        categorySourceName: product.category?.sourceName ?? null,
        sourceCategoryPath: path,
        sourceCategoryPathLabel: path.join(' → '),
        coverPath: product.cover?.pathFile ?? null,
        variantSizes: previewAttributes.variantSizes,
        sourceAttributes: previewAttributes.sourceAttributes,
        ...relevanceFields,
      },
      destinations,
      note:
        'پیش‌نمایش مقصد فروشگاه بر اساس نگاشت‌های فعال و قوانین مخاطب محاسبه می‌شود و با تعیین جنسیت تغییری در نگاشت‌ها ایجاد نمی‌کند.',
    };
  }

  async resolveProductGenderAdmin(input: {
    productId?: unknown;
    gender?: unknown;
    actor?: string | null;
  }) {
    const { productId, gender } = parseGenderResolutionInput(input);
    const actor = input.actor ? String(input.actor).slice(0, 128) : 'admin:unknown';

    const product = await this.productRepository.findOne({
      where: { id: productId, isDeleted: false },
      select: ['id', 'gender', 'categoryId', 'name', 'sourceName', 'ageGroup', 'status'],
    });
    if (!product || product.categoryId === 1) {
      throw new GenderReviewValidationError(
        'محصول یافت نشد.',
        'not_found',
      );
    }

    const relevance = await this.loadRelevanceIndex();
    const categoryRelevance = relevance.get(Number(product.categoryId));
    const effectiveRelevance = categoryRelevance
      ? refineGenderRelevance(
          categoryRelevance,
          await this.productSignals(product),
        )
      : undefined;
    if (effectiveRelevance && !effectiveRelevance.reviewable) {
      throw new GenderReviewValidationError(
        'جنسیت برای این دسته موضوعیت ندارد و از این صف تعیین نمی‌شود.',
        'not_applicable',
      );
    }

    const previousGender = product.gender ?? null;
    if (
      previousGender != null &&
      (['female', 'male', 'unisex'] as string[]).includes(previousGender)
    ) {
      throw new GenderReviewValidationError(
        'جنسیت این محصول قبلاً تعیین شده است. برای تغییر از صفحه ویرایش محصول استفاده کنید.',
        'already_resolved',
      );
    }

    const resolvedAt = new Date();
    await this.productRepository.manager.transaction(async (em) => {
      const updated = await em
        .createQueryBuilder()
        .update(ProductEntity)
        .set({ gender })
        .where('id = :id', { id: productId })
        .andWhere('isDeleted = 0')
        .andWhere('(gender IS NULL OR gender NOT IN (:...resolved))', {
          resolved: ['female', 'male', 'unisex'],
        })
        .execute();
      if (!updated.affected) {
        throw new GenderReviewValidationError(
          'جنسیت این محصول هم‌زمان توسط کاربر دیگری تعیین شده است.',
          'already_resolved',
        );
      }

      const stateRow = await em.findOne(AssortmentPolicyStateEntity, {
        where: { id: 1 },
      });
      await em.insert(AssortmentPolicyAuditEntity, {
        operation: 'product_gender_resolve',
        ruleId: null,
        actor,
        beforeJson: {
          productId,
          gender: previousGender,
          categoryId: product.categoryId,
        },
        afterJson: {
          productId,
          gender,
          categoryId: product.categoryId,
          name: product.name,
        },
        policyVersion: stateRow?.policyVersion ?? 0,
        createdAt: resolvedAt,
      });
    });

    // Gender change can alter adult-audience PLP membership; drop facet cache.
    clearStorefrontPlpFacetCache();

    const destinations = await this.previewDestinationsForProduct({
      categoryId: product.categoryId,
    });

    return {
      productId,
      previousGender,
      gender,
      destinations,
      resolvedAt: formatStoredDateTime(resolvedAt),
    };
  }

  private baseScopeQb(scope: GenderReviewScope) {
    const qb = this.productRepository
      .createQueryBuilder('p')
      .where('p.isDeleted = 0')
      .andWhere('p.categoryId != 1');

    if (scope === 'discoverable') {
      qb.andWhere('p.status = :status', { status: ProductStatus.active })
        .andWhere('p.price > 0')
        .andWhere(discoveryEligibilitySql('p'));
    }
    return qb;
  }

  private notApplicableCategoryIds(
    relevance: Map<number, GenderRelevanceDecision>,
  ): number[] {
    return [...relevance.entries()]
      .filter(([, decision]) => !decision.reviewable)
      .map(([id]) => id);
  }

  private baseReviewableQb(
    scope: GenderReviewScope,
    relevance: Map<number, GenderRelevanceDecision>,
  ) {
    const qb = this.baseScopeQb(scope).andWhere(unresolvedGenderSql('p'));
    const excluded = this.notApplicableCategoryIds(relevance);
    if (excluded.length) {
      qb.andWhere('p.categoryId NOT IN (:...notApplicableIds)', {
        notApplicableIds: excluded,
      });
    }
    return qb;
  }

  private relevanceFields(
    decision: GenderRelevanceDecision | undefined,
    product?: {
      name?: string | null;
      sourceName?: string | null;
      ageGroup?: string | null;
      attributes?: GenderRelevanceAttribute[] | null;
    },
  ) {
    const category =
      decision ??
      classifyGenderRelevance({
        hierarchy: null,
        businessDomain: null,
        categoryGender: null,
      });
    const resolved = decision
      ? refineGenderRelevance(category, product)
      : category;
    return {
      classification: resolved.relevance,
      classificationLabel: resolved.reasonLabel,
      relevance: resolved.relevance,
      relevanceReason: resolved.reason,
      relevanceReasonLabel: resolved.reasonLabel,
      relevanceReasonBadge: resolved.reasonBadge,
    };
  }

  private async sourceScopeIdsOrNull(
    sourceCategoryId: number | null,
  ): Promise<number[] | null> {
    if (sourceCategoryId == null || !Number.isInteger(sourceCategoryId)) {
      return null;
    }
    return this.resolveSourceScopeIds(sourceCategoryId);
  }

  private emptySummary(
    scope: GenderReviewScope,
    sourceCategoryId: number | null,
  ) {
    return {
      scope,
      sourceCategoryId:
        sourceCategoryId != null && Number.isInteger(sourceCategoryId)
          ? sourceCategoryId
          : null,
      unresolvedCount: 0,
      reviewRequiredCount: 0,
      notApplicableCount: 0,
      resolvedCount: 0,
      reviewByReason: [],
      excludedByReason: [],
      semantics:
        scope === 'discoverable'
          ? 'discoverable_storefront'
          : 'non_deleted_catalog',
    };
  }

  private async summarizeRelevance(
    scope: GenderReviewScope,
    sourceCategoryId: number | null,
    scopeIds: number[] | null,
    relevance: Map<number, GenderRelevanceDecision>,
    footwear: Map<number, GenderRelevanceDecision> = new Map(),
    apparel: Map<number, GenderRelevanceDecision> = new Map(),
  ) {
    const unresolvedQb = this.baseScopeQb(scope).andWhere(unresolvedGenderSql('p'));
    const resolvedQb = this.baseScopeQb(scope).andWhere(
      "p.gender IN ('female','male','unisex')",
    );
    if (scopeIds) {
      unresolvedQb.andWhere('p.categoryId IN (:...scopeIds)', { scopeIds });
      resolvedQb.andWhere('p.categoryId IN (:...scopeIds)', { scopeIds });
    }

    const [grouped, resolvedCount] = await Promise.all([
      unresolvedQb
        .select('p.categoryId', 'categoryId')
        .addSelect('COUNT(*)', 'n')
        .groupBy('p.categoryId')
        .getRawMany<{ categoryId: number | string; n: number | string }>(),
      resolvedQb.getCount(),
    ]);

    const reviewByReason = new Map<string, { reason: string; reasonLabel: string; count: number }>();
    const excludedByReason = new Map<string, { reason: string; reasonLabel: string; count: number }>();
    let reviewRequiredCount = 0;
    let notApplicableCount = 0;
    for (const row of grouped) {
      const categoryId = Number(row.categoryId);
      const count = Number(row.n);
      const fields = this.relevanceFields(relevance.get(categoryId));
      const bucket = fields.relevance === 'gender_not_applicable'
        ? excludedByReason
        : reviewByReason;
      if (fields.relevance === 'gender_not_applicable') notApplicableCount += count;
      else reviewRequiredCount += count;
      const current = bucket.get(fields.relevanceReason) ?? {
        reason: fields.relevanceReason,
        reasonLabel: fields.relevanceReasonLabel,
        count: 0,
      };
      current.count += count;
      bucket.set(fields.relevanceReason, current);
    }

    const applyRefinements = (
      originalReason: string,
      refinedMap: Map<number, GenderRelevanceDecision>,
    ) => {
      for (const refined of refinedMap.values()) {
        const sourceBucket = reviewByReason.get(originalReason);
        if (sourceBucket) {
          sourceBucket.count -= 1;
          if (sourceBucket.count <= 0) reviewByReason.delete(originalReason);
        }
        reviewRequiredCount -= 1;
        const bucket = refined.reviewable ? reviewByReason : excludedByReason;
        if (refined.reviewable) reviewRequiredCount += 1;
        else notApplicableCount += 1;
        const current = bucket.get(refined.reason) ?? {
          reason: refined.reason,
          reasonLabel: refined.reasonLabel,
          count: 0,
        };
        current.count += 1;
        bucket.set(refined.reason, current);
      }
    };
    applyRefinements('footwear', footwear);
    applyRefinements('adult_apparel', apparel);

    return {
      scope,
      sourceCategoryId:
        sourceCategoryId != null && Number.isInteger(sourceCategoryId)
          ? sourceCategoryId
          : null,
      unresolvedCount: reviewRequiredCount,
      reviewRequiredCount,
      notApplicableCount,
      resolvedCount,
      reviewByReason: [...reviewByReason.values()].sort((a, b) => b.count - a.count),
      excludedByReason: [...excludedByReason.values()].sort((a, b) => b.count - a.count),
      semantics:
        scope === 'discoverable'
          ? 'discoverable_storefront'
          : 'non_deleted_catalog',
    };
  }

  private async loadRelevanceIndex(): Promise<Map<number, GenderRelevanceDecision>> {
    const categories = await this.categoryRepository.find({
      select: ['id', 'hierarchy', 'gender', 'bankTypeName'],
    });
    const domainById = new Map<number, string | null>();
    const manager = this.productRepository.manager as {
      query?: (
        sql: string,
      ) => Promise<Array<{ categoryId: number; businessDomain: string | null }>>;
    };
    if (typeof manager.query === 'function') {
      const rows = await manager.query(
        'SELECT categoryId, businessDomain FROM category_assortment_resolution',
      );
      for (const row of rows) {
        domainById.set(Number(row.categoryId), row.businessDomain ?? null);
      }
    }
    const index = new Map<number, GenderRelevanceDecision>();
    for (const category of categories) {
      index.set(
        Number(category.id),
        classifyGenderRelevance({
          hierarchy: category.hierarchy,
          businessDomain: domainById.get(Number(category.id)) ?? null,
          categoryGender: category.gender,
        }),
      );
    }
    return index;
  }

  /**
   * Product-level overrides for general footwear and apparel categories.
   * Only decisions that differ from the category are returned.
   * Confident children's products are not reviewable and leave the queue.
   */
  private async loadAudienceRefinements(
    scope: GenderReviewScope,
    scopeIds: number[] | null,
    relevance: Map<number, GenderRelevanceDecision>,
  ): Promise<{
    footwear: Map<number, GenderRelevanceDecision>;
    apparel: Map<number, GenderRelevanceDecision>;
  }> {
    const [footwear, apparel] = await Promise.all([
      this.loadProductRefinements(scope, scopeIds, relevance, 'footwear'),
      this.loadProductRefinements(scope, scopeIds, relevance, 'adult_apparel'),
    ]);
    return { footwear, apparel };
  }

  private async loadProductRefinements(
    scope: GenderReviewScope,
    scopeIds: number[] | null,
    relevance: Map<number, GenderRelevanceDecision>,
    reason: 'footwear' | 'adult_apparel',
  ): Promise<Map<number, GenderRelevanceDecision>> {
    const result = new Map<number, GenderRelevanceDecision>();
    let categoryIds = [...relevance.entries()]
      .filter(([, decision]) => decision.reason === reason && decision.reviewable)
      .map(([id]) => id);
    if (scopeIds) {
      const allowed = new Set(scopeIds);
      categoryIds = categoryIds.filter((id) => allowed.has(id));
    }
    if (!categoryIds.length) return result;

    const rows = await this.baseScopeQb(scope)
      .andWhere(unresolvedGenderSql('p'))
      .andWhere('p.categoryId IN (:...categoryIds)', { categoryIds })
      .select(['p.id', 'p.name', 'p.sourceName', 'p.ageGroup', 'p.categoryId'])
      .getMany();
    const attributes = await this.loadGenderAttributes(
      rows.map((row) => Number(row.id)),
    );
    for (const row of rows) {
      const category = relevance.get(Number(row.categoryId));
      if (!category) continue;
      const refined = refineGenderRelevance(category, {
        name: row.name,
        sourceName: row.sourceName,
        ageGroup: row.ageGroup,
        attributes: attributes.get(Number(row.id)) ?? [],
      });
      if (
        refined.reason !== category.reason ||
        refined.relevance !== category.relevance
      ) {
        result.set(Number(row.id), refined);
      }
    }
    return result;
  }

  private async productSignals(product: {
    id: number;
    name?: string | null;
    sourceName?: string | null;
    ageGroup?: string | null;
  }) {
    const attributes = await this.loadGenderAttributes([Number(product.id)]);
    return {
      name: product.name,
      sourceName: product.sourceName,
      ageGroup: product.ageGroup,
      attributes: attributes.get(Number(product.id)) ?? [],
    };
  }

  private async loadGenderAttributes(
    productIds: number[],
  ): Promise<Map<number, GenderRelevanceAttribute[]>> {
    const grouped = new Map<number, GenderRelevanceAttribute[]>();
    if (!productIds.length) return grouped;
    const manager = this.productRepository.manager as {
      query?: (sql: string, params?: unknown[]) => Promise<GenderRelevanceAttribute[]>;
    };
    if (typeof manager.query !== 'function') return grouped;
    const placeholders = productIds.map(() => '?').join(',');
    const rows = await manager.query(
      `SELECT pav.productId AS productId,
              a.name AS name,
              a.sourceName AS sourceName,
              a.type AS kind,
              av.name AS value,
              av.sourceName AS valueSource
       FROM product_attribute_value pav
       INNER JOIN attribute_value av ON av.id = pav.attributeValueId
       INNER JOIN attribute a ON a.id = av.attributeId
       WHERE pav.isDeleted = 0
         AND pav.productId IN (${placeholders})`,
      productIds,
    );
    for (const row of rows || []) {
      const productId = Number((row as { productId?: number }).productId);
      if (!productId) continue;
      const list = grouped.get(productId) ?? [];
      list.push({
        name: row.name,
        sourceName: row.sourceName,
        value: row.value,
        valueSource: row.valueSource,
        kind: row.kind,
      });
      grouped.set(productId, list);
    }
    return grouped;
  }

  private async resolveSourceScopeIds(
    sourceCategoryId: number,
  ): Promise<number[]> {
    if (!Number.isInteger(sourceCategoryId) || sourceCategoryId <= 1) {
      return [];
    }
    const category = await this.categoryRepository.findOne({
      where: { id: sourceCategoryId },
      select: ['id', 'source'],
    });
    if (!category) return [];
    const taxonomy = await this.categoryRepository.find({
      select: ['id', 'parentId', 'source', 'status', 'displayOrder', 'name'],
    });
    return expandSourceCategoryScopeIds(
      category.id,
      category.source,
      taxonomy,
    );
  }

  private async previewDestinationsForProduct(product: {
    categoryId: number;
  }) {
    const mappings = await this.mappingRepository.find({
      where: { status: SourceCategoryMappingStatus.active },
      select: ['canonicalCategoryId', 'sourceCategoryId', 'status'],
    });
    // Only evaluate canonicals that map this product's source category
    // (or would after same-source expansion — handled inside the resolver).
    const candidateCanonicalIds = [
      ...new Set(
        mappings
          .filter((m) => Number(m.sourceCategoryId) > 1)
          .map((m) => Number(m.canonicalCategoryId)),
      ),
    ].sort((a, b) => a - b);

    if (!candidateCanonicalIds.length) {
      return buildGenderDestinationPreview(product, []);
    }

    const data = await loadCanonicalEligibilityData(
      this.productRepository.manager,
    );
    const eligibilities = candidateCanonicalIds
      .map((canonicalCategoryId) => {
        const eligibility = resolveCanonicalProductEligibilityFromData(
          canonicalCategoryId,
          data,
        );
        if (!eligibility.sourceCategoryIds.length) return null;
        // Skip destinations that cannot include this source category at all.
        if (
          !eligibility.sourceCategoryIds.includes(Number(product.categoryId))
        ) {
          return null;
        }
        const path = buildCanonicalPath(
          canonicalCategoryId,
          data.canonicalRows,
        );
        return {
          eligibility,
          target: {
            canonicalCategoryId,
            pathLabel: path.join(' / '),
          },
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    return buildGenderDestinationPreview(product, eligibilities);
  }
}