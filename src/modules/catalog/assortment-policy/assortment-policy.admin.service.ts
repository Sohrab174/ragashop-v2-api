/**
 * SCOPE-3/4 — Assortment Admin workflow (queue / detail / preview / apply).
 * Employee actions create CATEGORY overrides only. Path-rule editing is not
 * exposed here (admin/high-privilege later).
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoryEntity } from '../../category/entities/category.entity';
import { discoveryEligibilitySql } from '../../product/discovery-eligibility';
import {
  ProductEntity,
  ProductStatus,
} from '../../product/entities/product.entity';
import {
  SourceCategoryMappingEntity,
  SourceCategoryMappingStatus,
} from '../entities/source-category-mapping.entity';
import {
  buildSourceCategoryPath,
  expandSourceCategoryScopeIds,
} from '../cat-map-v2c-distribution';
import {
  AssortmentPolicyAdminValidationError,
  assertValidAssortmentStatus,
  diffAssortmentDecisions,
  summarizeAssortmentImpact,
  withHypotheticalCategoryOverride,
} from './assortment-policy.impact';
import {
  assortmentDomainLabelFa,
  assortmentReasonLabelFa,
  assortmentStatusLabelFa,
  assortmentViaLabelFa,
} from './assortment-policy.labels';
import { AssortmentPolicyRecomputeService } from './assortment-policy.recompute.service';
import { AssortmentAutoMapService } from './assortment-auto-map.service';
import { AssortmentPolicyRuleService } from './assortment-policy.rule.service';
import { AssortmentPolicyStatus } from './assortment-policy.types';
import { AssortmentPolicyAuditEntity } from './entities/assortment-policy-audit.entity';
import { AssortmentPolicyRuleEntity } from './entities/assortment-policy-rule.entity';
import { AssortmentPolicyStateEntity } from './entities/assortment-policy-state.entity';
import { CategoryAssortmentResolutionEntity } from './entities/category-assortment-resolution.entity';

type QueueRow = {
  sourceCategoryId: number;
  displayName: string;
  provider: string | null;
  path: string[];
  pathLabel: string;
  businessDomain: string | null;
  businessDomainLabel: string;
  status: AssortmentPolicyStatus;
  statusLabel: string;
  reasonCode: string;
  reasonLabel: string;
  via: string;
  viaLabel: string;
  isExplicitOverride: boolean;
  liveProductCount: number;
  discoverableProductCount: number;
  mappingCount: number;
  orderItemCount: number;
  unlocksMappingWork: boolean;
  impactScore: number;
};

@Injectable()
export class AssortmentPolicyAdminService {
  constructor(
    @InjectRepository(CategoryAssortmentResolutionEntity)
    private readonly resolutionRepo: Repository<CategoryAssortmentResolutionEntity>,
    @InjectRepository(AssortmentPolicyRuleEntity)
    private readonly ruleRepo: Repository<AssortmentPolicyRuleEntity>,
    @InjectRepository(AssortmentPolicyAuditEntity)
    private readonly auditRepo: Repository<AssortmentPolicyAuditEntity>,
    @InjectRepository(AssortmentPolicyStateEntity)
    private readonly stateRepo: Repository<AssortmentPolicyStateEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoryRepo: Repository<CategoryEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
    @InjectRepository(SourceCategoryMappingEntity)
    private readonly mappingRepo: Repository<SourceCategoryMappingEntity>,
    private readonly ruleService: AssortmentPolicyRuleService,
    private readonly recomputeService: AssortmentPolicyRecomputeService,
    private readonly autoMapService: AssortmentAutoMapService,
  ) {}

  async getSummaryAdmin() {
    const [state, byStatus, autoMap] = await Promise.all([
      this.stateRepo.findOne({ where: { id: 1 } }),
      this.resolutionRepo
        .createQueryBuilder('r')
        .select('r.status', 'status')
        .addSelect('COUNT(*)', 'categories')
        .groupBy('r.status')
        .getRawMany(),
      this.autoMapService.computeAdmin(),
    ]);
    const missingDest = {
      categories: autoMap.coverage.categories.inScopeMissingDestination,
      products: autoMap.coverage.products.inScopeMissingDestinationProducts,
    };
    const counts: Record<string, number> = {
      IN_SCOPE: 0,
      REVIEW_REQUIRED: 0,
      OUT_OF_SCOPE: 0,
    };
    for (const row of byStatus) {
      counts[String(row.status)] = Number(row.categories);
    }
    const productByStatus = await this.discoverableCountsByStatus();
    return {
      policyVersion: state?.policyVersion ?? 0,
      categories: {
        inScope: counts.IN_SCOPE,
        reviewRequired: counts.REVIEW_REQUIRED,
        outOfScope: counts.OUT_OF_SCOPE,
        total:
          counts.IN_SCOPE + counts.REVIEW_REQUIRED + counts.OUT_OF_SCOPE,
      },
      products: productByStatus,
      inScopeMissingDestination: missingDest,
      autoMap: {
        inScopeDiscoverable: autoMap.coverage.products.inScopeDiscoverable,
        highRoutable: autoMap.coverage.products.autoMapHighRoutable,
        highSuggestRoutable:
          autoMap.coverage.products.autoMapHighSuggestRoutable,
        highPctOfInScope: autoMap.coverage.percents.autoMapHighOfInScope,
        highSuggestPctOfInScope:
          autoMap.coverage.percents.autoMapHighSuggestOfInScope,
        inScopeByTier: autoMap.inScopeByTier,
      },
      labels: {
        inScope: assortmentStatusLabelFa('IN_SCOPE'),
        reviewRequired: assortmentStatusLabelFa('REVIEW_REQUIRED'),
        outOfScope: assortmentStatusLabelFa('OUT_OF_SCOPE'),
      },
    };
  }

  async listReviewQueueAdmin(options?: {
    status?: string | null;
    q?: string | null;
    provider?: string | null;
    businessDomain?: string | null;
    reasonCode?: string | null;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(Number(options?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(options?.limit) || 50, 1), 200);
    const statusFilter = options?.status
      ? String(options.status).trim()
      : 'REVIEW_REQUIRED';
    const q = options?.q ? String(options.q).trim().toLowerCase() : '';
    const provider = options?.provider
      ? String(options.provider).trim().toLowerCase()
      : '';
    const domain = options?.businessDomain
      ? String(options.businessDomain).trim()
      : '';
    const reason = options?.reasonCode
      ? String(options.reasonCode).trim()
      : '';

    const rows = await this.buildQueueRows();
    let filtered = rows;
    if (statusFilter && statusFilter !== 'ALL') {
      filtered = filtered.filter((r) => r.status === statusFilter);
    }
    if (provider) {
      filtered = filtered.filter(
        (r) => String(r.provider || '').toLowerCase() === provider,
      );
    }
    if (domain) {
      filtered = filtered.filter((r) => r.businessDomain === domain);
    }
    if (reason) {
      filtered = filtered.filter((r) => r.reasonCode === reason);
    }
    if (q) {
      filtered = filtered.filter((r) => {
        const hay = `${r.displayName} ${r.pathLabel} ${r.provider || ''} ${
          r.reasonLabel
        } ${r.businessDomainLabel}`.toLowerCase();
        return hay.includes(q);
      });
    }

    // Priority: product impact → unlocks mapping → has mapping/orders → low volume last
    filtered.sort((a, b) => {
      if (b.impactScore !== a.impactScore) return b.impactScore - a.impactScore;
      if (Number(b.unlocksMappingWork) !== Number(a.unlocksMappingWork)) {
        return Number(b.unlocksMappingWork) - Number(a.unlocksMappingWork);
      }
      if (b.mappingCount !== a.mappingCount)
        return b.mappingCount - a.mappingCount;
      if (b.orderItemCount !== a.orderItemCount)
        return b.orderItemCount - a.orderItemCount;
      return a.sourceCategoryId - b.sourceCategoryId;
    });

    const total = filtered.length;
    const start = (page - 1) * limit;
    return {
      items: filtered.slice(start, start + limit),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      defaultStatus: 'REVIEW_REQUIRED',
    };
  }

  async getCategoryDetailAdmin(sourceCategoryId: number) {
    const id = Number(sourceCategoryId);
    if (!Number.isInteger(id) || id <= 1) {
      throw new NotFoundException('دسته‌بندی منبع یافت نشد.');
    }
    const category = await this.categoryRepo.findOne({ where: { id } });
    if (!category) throw new NotFoundException('دسته‌بندی منبع یافت نشد.');

    const [taxonomy, resolution, override, mappings, gender] =
      await Promise.all([
        this.categoryRepo.find({
          select: [
            'id',
            'parentId',
            'source',
            'sourceName',
            'name',
            'displayOrder',
            'status',
          ],
        }),
        this.resolutionRepo.findOne({ where: { categoryId: id } }),
        this.ruleRepo.findOne({
          where: {
            matchType: 'category' as any,
            categoryId: id,
            isActive: true,
          },
        }),
        this.mappingRepo.find({ where: { sourceCategoryId: id } }),
        this.genderCountsForCategory(id),
      ]);

    const path = buildSourceCategoryPath(id, taxonomy);
    const displayName =
      category.sourceName || category.name || `دسته ${category.id}`;
    const children = taxonomy.filter((c) => Number(c.parentId) === id);
    const childResolutions = children.length
      ? await this.resolutionRepo
          .createQueryBuilder('r')
          .where('r.categoryId IN (:...ids)', {
            ids: children.map((c) => Number(c.id)),
          })
          .getMany()
      : [];
    const orderItems = await this.orderItemCountForCategories([id]);
    const rule =
      override ||
      (resolution?.ruleId
        ? await this.ruleRepo.findOne({ where: { id: resolution.ruleId } })
        : null);

    const status = (resolution?.status ||
      'REVIEW_REQUIRED') as AssortmentPolicyStatus;

    return {
      sourceCategoryId: id,
      displayName,
      provider: category.source,
      path,
      pathLabel: path.filter(Boolean).join(' → '),
      status,
      statusLabel: assortmentStatusLabelFa(status),
      reasonCode: resolution?.reasonCode || 'UNCLASSIFIED',
      reasonLabel: assortmentReasonLabelFa(resolution?.reasonCode),
      via: resolution?.via || 'unclassified',
      viaLabel: assortmentViaLabelFa(resolution?.via),
      isExplicitOverride: !!override,
      businessDomain: resolution?.businessDomain || null,
      businessDomainLabel: assortmentDomainLabelFa(resolution?.businessDomain),
      policyVersion: resolution?.policyVersion || 0,
      productCounts: {
        live: gender.live,
        discoverable: gender.discoverable,
        female: gender.female,
        male: gender.male,
        unisex: gender.unisex,
        unknown: gender.unknown,
      },
      mapping: {
        count: mappings.length,
        activeCount: mappings.filter(
          (m) => m.status === SourceCategoryMappingStatus.active,
        ).length,
        destinations: mappings.map((m) => ({
          id: m.id,
          canonicalCategoryId: m.canonicalCategoryId,
          genderSlice: m.genderSlice,
          status: m.status,
          reviewStatus: m.reviewStatus,
        })),
      },
      orderItemCount: orderItems[id] || 0,
      descendants: {
        count: children.length,
        byStatus: this.countByStatus(
          childResolutions.map((r) => r.status),
        ),
      },
      responsibleRule: rule
        ? {
            id: rule.id,
            matchType: rule.matchType,
            status: rule.status,
            reasonCode: rule.reasonCode,
            reasonLabel: assortmentReasonLabelFa(rule.reasonCode),
            pathPrefixNorm: rule.pathPrefixNorm,
            note: rule.note,
            updatedBy: rule.updatedBy,
            updatedAt: rule.updatedAt,
          }
        : null,
      actions: {
        allowedStatuses: ['IN_SCOPE', 'REVIEW_REQUIRED', 'OUT_OF_SCOPE'],
        labels: {
          IN_SCOPE: assortmentStatusLabelFa('IN_SCOPE'),
          REVIEW_REQUIRED: assortmentStatusLabelFa('REVIEW_REQUIRED'),
          OUT_OF_SCOPE: assortmentStatusLabelFa('OUT_OF_SCOPE'),
        },
      },
      debug: {
        sourceCategoryId: id,
        ruleId: resolution?.ruleId ?? null,
        selectorKey: override?.selectorKey ?? null,
      },
    };
  }

  async listAuditAdmin(options?: {
    categoryId?: number | null;
    ruleId?: number | null;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(Number(options?.limit) || 50, 1), 200);
    const qb = this.auditRepo
      .createQueryBuilder('a')
      .orderBy('a.id', 'DESC')
      .take(limit);
    if (options?.ruleId) {
      qb.andWhere('a.ruleId = :ruleId', { ruleId: Number(options.ruleId) });
    }
    if (options?.categoryId) {
      const catId = Number(options.categoryId);
      qb.andWhere(
        `(a.ruleId IN (SELECT id FROM assortment_policy_rule WHERE categoryId = :catId)
          OR JSON_EXTRACT(a.afterJson, '$.categoryId') = :catId
          OR JSON_EXTRACT(a.beforeJson, '$.categoryId') = :catId
          OR JSON_EXTRACT(a.afterJson, '$.sourceCategoryId') = :catId)`,
        { catId },
      );
    }
    const rows = await qb.getMany();
    return {
      items: rows.map((a) => this.presentAudit(a)),
    };
  }

  /**
   * Preview a category override. Evaluates in memory; never persists.
   */
  async previewDecisionAdmin(input: {
    sourceCategoryId: number;
    targetStatus: string;
    note?: string | null;
  }) {
    const id = Number(input.sourceCategoryId);
    if (!Number.isInteger(id) || id <= 1) {
      throw new AssortmentPolicyAdminValidationError(
        'دسته‌بندی منبع نامعتبر است.',
        'invalid_category',
      );
    }
    const targetStatus = assertValidAssortmentStatus(input.targetStatus);
    const category = await this.categoryRepo.findOne({ where: { id } });
    if (!category) {
      throw new AssortmentPolicyAdminValidationError(
        'دسته‌بندی منبع یافت نشد.',
        'invalid_category',
      );
    }

    const impact = await this.computeImpactForOverride(id, targetStatus);
    return {
      sourceCategoryId: id,
      targetStatus,
      targetStatusLabel: assortmentStatusLabelFa(targetStatus),
      note: input.note ? String(input.note).slice(0, 512) : null,
      persisted: false,
      current: impact.current,
      proposed: impact.proposed,
      impact: impact.summary,
      confirmationRequired: impact.summary.confirmationRequired,
    };
  }

  /**
   * Apply a category override transactionally:
   * validate → preview → confirm → upsert override → audit → recompute.
   */
  async applyDecisionAdmin(input: {
    sourceCategoryId: number;
    targetStatus: string;
    note?: string | null;
    confirmImpact?: boolean;
    actor?: string | null;
  }) {
    const id = Number(input.sourceCategoryId);
    if (!Number.isInteger(id) || id <= 1) {
      throw new AssortmentPolicyAdminValidationError(
        'دسته‌بندی منبع نامعتبر است.',
        'invalid_category',
      );
    }
    const targetStatus = assertValidAssortmentStatus(input.targetStatus);
    const category = await this.categoryRepo.findOne({ where: { id } });
    if (!category) {
      throw new AssortmentPolicyAdminValidationError(
        'دسته‌بندی منبع یافت نشد.',
        'invalid_category',
      );
    }

    const impact = await this.computeImpactForOverride(id, targetStatus);
    if (
      impact.summary.confirmationRequired &&
      input.confirmImpact !== true
    ) {
      throw new AssortmentPolicyAdminValidationError(
        'این تغییر پرتأثیر است و نیاز به تأیید دارد.',
        'confirm_required',
        {
          impactedCategoryCount: impact.summary.impactedCategoryCount,
          impactedProductCount:
            impact.summary.impactedDiscoverableProductCount,
          impactedLiveProductCount: impact.summary.impactedLiveProductCount,
          existingMappingCount: impact.summary.existingMappingCount,
          existingOrderItemCount: impact.summary.existingOrderItemCount,
          confirmationRequired: true,
          highRiskReasons: impact.summary.highRiskReasons,
        },
      );
    }

    const actor = input.actor || 'admin:unknown';
    const note = input.note ? String(input.note).slice(0, 512) : null;
    const existing = await this.ruleRepo.findOne({
      where: {
        matchType: 'category' as any,
        categoryId: id,
      },
    });

    const previousResolution = impact.current;

    const result = await this.ruleRepo.manager.transaction(async (em) => {
      let rule: AssortmentPolicyRuleEntity;
      if (existing) {
        rule = await this.ruleService.updateRule(
          existing.id,
          {
            status: targetStatus,
            reasonCode: 'EMPLOYEE_OVERRIDE',
            note,
            isActive: true,
            businessDomain: previousResolution.businessDomain,
            matchType: 'category',
            categoryId: id,
            pathPrefix: null,
            provider: null,
          },
          actor,
          em,
        );
      } else {
        rule = await this.ruleService.createRule(
          {
            matchType: 'category',
            categoryId: id,
            pathPrefix: null,
            provider: null,
            status: targetStatus,
            reasonCode: 'EMPLOYEE_OVERRIDE',
            businessDomain: previousResolution.businessDomain,
            note,
            isActive: true,
          },
          actor,
          em,
        );
      }

      const stateRow = await em.findOne(AssortmentPolicyStateEntity, {
        where: { id: 1 },
      });
      await em.insert(AssortmentPolicyAuditEntity, {
        operation: 'category_decision',
        ruleId: rule.id,
        actor,
        beforeJson: {
          sourceCategoryId: id,
          status: previousResolution.status,
          reasonCode: previousResolution.reasonCode,
          via: previousResolution.via,
        },
        afterJson: {
          sourceCategoryId: id,
          status: targetStatus,
          reasonCode: 'EMPLOYEE_OVERRIDE',
          via: 'category_override',
          note,
          impact: {
            impactedCategoryCount: impact.summary.impactedCategoryCount,
            impactedDiscoverableProductCount:
              impact.summary.impactedDiscoverableProductCount,
            existingMappingCount: impact.summary.existingMappingCount,
            existingOrderItemCount: impact.summary.existingOrderItemCount,
          },
        },
        policyVersion: stateRow?.policyVersion ?? 0,
        createdAt: new Date(),
      });

      const recompute = await this.recomputeService.recomputeWithin(
        em,
        actor,
        {
          rulesChanged: true,
          auditContext: {
            sourceCategoryId: id,
            decision: targetStatus,
          },
        },
      );

      const finalResolution = await em.findOne(
        CategoryAssortmentResolutionEntity,
        { where: { categoryId: id } },
      );

      return { rule, recompute, finalResolution };
    });
    this.autoMapService.invalidate();

    return {
      sourceCategoryId: id,
      status: result.finalResolution?.status || targetStatus,
      statusLabel: assortmentStatusLabelFa(
        result.finalResolution?.status || targetStatus,
      ),
      reasonCode: result.finalResolution?.reasonCode || 'EMPLOYEE_OVERRIDE',
      reasonLabel: assortmentReasonLabelFa(
        result.finalResolution?.reasonCode || 'EMPLOYEE_OVERRIDE',
      ),
      via: result.finalResolution?.via || 'category_override',
      policyVersion: result.recompute.policyVersion,
      recomputeChanged: result.recompute.changed,
      impact: impact.summary,
      overrideRuleId: result.rule.id,
    };
  }

  // ─── internals ───────────────────────────────────────────────────────────

  private async computeImpactForOverride(
    categoryId: number,
    targetStatus: AssortmentPolicyStatus,
  ) {
    const inputs = await this.recomputeService.loadEvaluationInputs();
    const previous = await this.resolutionRepo.find();
    const state = await this.stateRepo.findOne({ where: { id: 1 } });
    const version = (state?.policyVersion || 0) + 1;

    const hypoRules = withHypotheticalCategoryOverride({
      rules: inputs.rules as any,
      categoryId,
      targetStatus,
      reasonCode: 'EMPLOYEE_OVERRIDE',
    });
    const proposed = this.recomputeService.evaluate(
      { ...inputs, rules: hypoRules as any },
      version,
    );
    const live = inputs.liveProductCountByCategoryId;
    const disc = await this.discoverableCountMap();
    const changes = diffAssortmentDecisions({
      previous: previous.map((r) => ({
        categoryId: Number(r.categoryId),
        status: r.status,
        reasonCode: r.reasonCode,
        ruleId: r.ruleId == null ? null : Number(r.ruleId),
        via: r.via,
        businessDomain: r.businessDomain ?? null,
      })),
      proposed,
      liveByCategoryId: live,
      discoverableByCategoryId: disc,
    });

    const changedIds = changes.map((c) => c.categoryId);
    const [mappingCounts, orderCounts] = await Promise.all([
      this.mappingCountForCategories(changedIds),
      this.orderItemCountForCategories(changedIds),
    ]);
    const summary = summarizeAssortmentImpact({
      changes,
      mappingCountByCategoryId: mappingCounts,
      orderItemCountByCategoryId: orderCounts,
      activeMappingCountByCategoryId: mappingCounts,
    });

    const currentRes = previous.find(
      (r) => Number(r.categoryId) === categoryId,
    );
    const proposedRes = proposed.find((d) => d.categoryId === categoryId);

    return {
      current: {
        status: currentRes?.status || null,
        statusLabel: assortmentStatusLabelFa(currentRes?.status),
        reasonCode: currentRes?.reasonCode || null,
        reasonLabel: assortmentReasonLabelFa(currentRes?.reasonCode),
        via: currentRes?.via || null,
        viaLabel: assortmentViaLabelFa(currentRes?.via),
        businessDomain: currentRes?.businessDomain || null,
      },
      proposed: {
        status: proposedRes?.status || targetStatus,
        statusLabel: assortmentStatusLabelFa(
          proposedRes?.status || targetStatus,
        ),
        reasonCode: proposedRes?.reasonCode || 'EMPLOYEE_OVERRIDE',
        reasonLabel: assortmentReasonLabelFa(
          proposedRes?.reasonCode || 'EMPLOYEE_OVERRIDE',
        ),
        via: proposedRes?.via || 'category_override',
        viaLabel: assortmentViaLabelFa(
          proposedRes?.via || 'category_override',
        ),
        businessDomain: proposedRes?.businessDomain || null,
      },
      summary,
    };
  }

  private async buildQueueRows(): Promise<QueueRow[]> {
    const [resolutions, taxonomy, liveMap, discMap, mappingCounts, orderCounts] =
      await Promise.all([
        this.resolutionRepo.find(),
        this.categoryRepo.find({
          select: [
            'id',
            'parentId',
            'source',
            'sourceName',
            'name',
            'displayOrder',
            'status',
          ],
        }),
        this.liveCountMap(),
        this.discoverableCountMap(),
        this.mappingCountForCategories(),
        this.orderItemCountForCategories(),
      ]);

    const byId = new Map(taxonomy.map((c) => [Number(c.id), c]));
    const rows: QueueRow[] = [];
    for (const r of resolutions) {
      const cat = byId.get(Number(r.categoryId));
      if (!cat || Number(cat.id) <= 1) continue;
      const path = buildSourceCategoryPath(Number(cat.id), taxonomy);
      const displayName = cat.sourceName || cat.name || `دسته ${cat.id}`;
      const live = Number(liveMap[Number(cat.id)] || 0);
      const disc = Number(discMap[Number(cat.id)] || 0);
      const mappingCount = Number(mappingCounts[Number(cat.id)] || 0);
      const orderItemCount = Number(orderCounts[Number(cat.id)] || 0);
      const unlocksMappingWork =
        r.status === 'REVIEW_REQUIRED' && disc > 0 && mappingCount === 0;
      // Impact score: discoverable weight + mapping/order boosts.
      const impactScore =
        disc * 10 + live + mappingCount * 50 + orderItemCount * 100;

      rows.push({
        sourceCategoryId: Number(cat.id),
        displayName,
        provider: cat.source,
        path,
        pathLabel: path.filter(Boolean).join(' → '),
        businessDomain: r.businessDomain,
        businessDomainLabel: assortmentDomainLabelFa(r.businessDomain),
        status: r.status as AssortmentPolicyStatus,
        statusLabel: assortmentStatusLabelFa(r.status),
        reasonCode: r.reasonCode,
        reasonLabel: assortmentReasonLabelFa(r.reasonCode),
        via: r.via,
        viaLabel: assortmentViaLabelFa(r.via),
        isExplicitOverride: r.via === 'category_override',
        liveProductCount: live,
        discoverableProductCount: disc,
        mappingCount,
        orderItemCount,
        unlocksMappingWork,
        impactScore,
      });
    }
    return rows;
  }

  private presentAudit(a: AssortmentPolicyAuditEntity) {
    const before = this.asObject(a.beforeJson);
    const after = this.asObject(a.afterJson);
    const prevStatus =
      (before?.status as string) ||
      (before?.sourceCategoryId != null ? String(before.status || '') : null);
    const nextStatus = (after?.status as string) || null;
    return {
      id: Number(a.id),
      operation: a.operation,
      actor: a.actor,
      createdAt: a.createdAt,
      policyVersion: a.policyVersion,
      previousStatus: prevStatus,
      previousStatusLabel: assortmentStatusLabelFa(prevStatus),
      newStatus: nextStatus,
      newStatusLabel: assortmentStatusLabelFa(nextStatus),
      note: (after?.note as string) || null,
      sourceCategoryId:
        (after?.sourceCategoryId as number) ||
        (before?.sourceCategoryId as number) ||
        null,
      ruleId: a.ruleId,
      // Raw JSON kept secondary for debug only.
      debug: { beforeJson: before, afterJson: after },
    };
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    if (value == null) return null;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    if (typeof value === 'object') return value as Record<string, unknown>;
    return null;
  }

  private countByStatus(statuses: string[]): Record<string, number> {
    const out: Record<string, number> = {
      IN_SCOPE: 0,
      REVIEW_REQUIRED: 0,
      OUT_OF_SCOPE: 0,
    };
    for (const s of statuses) {
      if (out[s] != null) out[s]++;
    }
    return out;
  }

  private async liveCountMap(): Promise<Record<number, number>> {
    const rows: Array<{ categoryId: number; n: string }> =
      await this.productRepo.query(
        `SELECT categoryId, COUNT(*) AS n FROM product WHERE isDeleted = 0 GROUP BY categoryId`,
      );
    const out: Record<number, number> = {};
    for (const r of rows) out[Number(r.categoryId)] = Number(r.n);
    return out;
  }

  private async discoverableCountMap(): Promise<Record<number, number>> {
    const rows = await this.productRepo
      .createQueryBuilder('p')
      .select('p.categoryId', 'categoryId')
      .addSelect('COUNT(*)', 'n')
      .where('p.isDeleted = 0')
      .andWhere('p.status = :status', { status: ProductStatus.active })
      .andWhere('p.price > 0')
      .andWhere('p.categoryId != 1')
      .andWhere(discoveryEligibilitySql('p'))
      .groupBy('p.categoryId')
      .getRawMany();
    const out: Record<number, number> = {};
    for (const r of rows) out[Number(r.categoryId)] = Number(r.n);
    return out;
  }

  private async discoverableCountsByStatus() {
    const rows: Array<{ status: string; products: string }> =
      await this.productRepo.query(
        `SELECT r.status AS status, COUNT(*) AS products
         FROM product p
         INNER JOIN category_assortment_resolution r ON r.categoryId = p.categoryId
         WHERE p.isDeleted = 0 AND p.status = 'active' AND p.price > 0
           AND p.categoryId != 1 AND ${discoveryEligibilitySql('p')}
         GROUP BY r.status`,
      );
    const out = {
      inScope: 0,
      reviewRequired: 0,
      outOfScope: 0,
      total: 0,
    };
    for (const r of rows) {
      const n = Number(r.products);
      out.total += n;
      if (r.status === 'IN_SCOPE') out.inScope = n;
      else if (r.status === 'REVIEW_REQUIRED') out.reviewRequired = n;
      else if (r.status === 'OUT_OF_SCOPE') out.outOfScope = n;
    }
    return out;
  }

  private async mappingCountForCategories(
    categoryIds?: number[],
  ): Promise<Record<number, number>> {
    const qb = this.mappingRepo
      .createQueryBuilder('m')
      .select('m.sourceCategoryId', 'sourceCategoryId')
      .addSelect('COUNT(*)', 'n')
      .where('m.status = :st', { st: SourceCategoryMappingStatus.active })
      .groupBy('m.sourceCategoryId');
    if (categoryIds && categoryIds.length) {
      qb.andWhere('m.sourceCategoryId IN (:...ids)', { ids: categoryIds });
    }
    const rows = await qb.getRawMany();
    const out: Record<number, number> = {};
    for (const r of rows) out[Number(r.sourceCategoryId)] = Number(r.n);
    return out;
  }

  private async orderItemCountForCategories(
    categoryIds?: number[],
  ): Promise<Record<number, number>> {
    // order_item → product.categoryId (read-only impact signal).
    let sql = `
      SELECT p.categoryId AS categoryId, COUNT(oi.id) AS n
      FROM order_item oi
      INNER JOIN product p ON p.id = oi.productId
      WHERE p.categoryId > 1`;
    const params: any[] = [];
    if (categoryIds && categoryIds.length) {
      sql += ` AND p.categoryId IN (${categoryIds.map(() => '?').join(',')})`;
      params.push(...categoryIds);
    }
    sql += ` GROUP BY p.categoryId`;
    const rows: Array<{ categoryId: number; n: string }> =
      await this.productRepo.query(sql, params);
    const out: Record<number, number> = {};
    for (const r of rows) out[Number(r.categoryId)] = Number(r.n);
    return out;
  }

  private async genderCountsForCategory(categoryId: number) {
    const taxonomy = await this.categoryRepo.find({
      select: ['id', 'parentId', 'source', 'status'],
    });
    const cat = taxonomy.find((c) => Number(c.id) === categoryId);
    const scopeIds = expandSourceCategoryScopeIds(
      categoryId,
      cat?.source || null,
      taxonomy,
    );
    const [liveRows, discRows] = await Promise.all([
      this.productRepo
        .createQueryBuilder('p')
        .select('p.gender', 'gender')
        .addSelect('COUNT(*)', 'count')
        .where('p.categoryId IN (:...ids)', { ids: scopeIds })
        .andWhere('p.isDeleted = 0')
        .groupBy('p.gender')
        .getRawMany(),
      this.productRepo
        .createQueryBuilder('p')
        .select('p.gender', 'gender')
        .addSelect('COUNT(*)', 'count')
        .where('p.categoryId IN (:...ids)', { ids: scopeIds })
        .andWhere('p.isDeleted = 0')
        .andWhere('p.status = :status', { status: ProductStatus.active })
        .andWhere('p.price > 0')
        .andWhere('p.categoryId != 1')
        .andWhere(discoveryEligibilitySql('p'))
        .groupBy('p.gender')
        .getRawMany(),
    ]);
    const agg = (rows: any[]) => {
      let female = 0,
        male = 0,
        unisex = 0,
        unknown = 0,
        total = 0;
      for (const r of rows) {
        const n = Number(r.count);
        total += n;
        if (r.gender === 'female') female += n;
        else if (r.gender === 'male') male += n;
        else if (r.gender === 'unisex') unisex += n;
        else unknown += n;
      }
      return { female, male, unisex, unknown, total };
    };
    const live = agg(liveRows);
    const discoverable = agg(discRows);
    return {
      live: live.total,
      discoverable: discoverable.total,
      female: discoverable.female,
      male: discoverable.male,
      unisex: discoverable.unisex,
      unknown: discoverable.unknown,
    };
  }
}
