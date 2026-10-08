/**
 * CAT-MAP-V2-C — Admin APIs for mapping detail, picker, atomic V2 save,
 * review queue, and Coverage V2. Does not mutate storefront discovery.
 */

import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { dateTime } from '../../utils';
import {
  CategoryEntity,
  CategoryStatus,
} from '../category/entities/category.entity';
import { discoveryEligibilitySql } from '../product/discovery-eligibility';
import {
  ProductEntity,
  ProductStatus,
} from '../product/entities/product.entity';
import {
  buildCanonicalPath,
  emptyDistribution,
  GenderDistribution,
  resolveCanonicalRoot,
} from './cat-map-v2a-classification';
import { resolveCanonicalCategoryScope } from './canonical-category-scope.resolver';
import { inferAudienceContext } from './canonical-presentation-image';
import {
  buildCoverageV2Summary,
  CoverageSourceCategoryRow,
  isReviewedActiveSlice,
} from './cat-map-v2c-coverage';
import {
  buildSourceCategoryPath,
  distributionFromGenderRows,
  expandSourceCategoryScopeIds,
} from './cat-map-v2c-distribution';
import {
  classifySourceCategoryScope,
  MappingRoutingStatus,
  pickPrimaryDestinationAudience,
  resolveMappingRoutingStatus,
  SourceMappingRuleRow,
} from './cat-map-v2c-routing';
import {
  resolveV2SaveReviewStatus,
  SourceCategoryMappingV2ValidationError,
  validateV2MappingSaveRequest,
  V2SaveRuleInput,
} from './cat-map-v2c-write.validation';
import {
  CanonicalCategoryEntity,
  CanonicalCategoryStatus,
} from './entities/canonical-category.entity';
import {
  SourceCategoryMappingEntity,
  SourceCategoryMappingGenderSlice,
  SourceCategoryMappingReviewStatus,
  SourceCategoryMappingStatus,
} from './entities/source-category-mapping.entity';
import { CategoryAssortmentResolutionEntity } from './assortment-policy/entities/category-assortment-resolution.entity';
import {
  buildAssortmentAwareCoverage,
  classifyLegacyMappingsByAssortment,
  isMappingEligibleStatus,
} from './assortment-policy/assortment-auto-map.gate';
import { assortmentStatusLabelFa } from './assortment-policy/assortment-policy.labels';
import { AssortmentAutoMapService } from './assortment-policy/assortment-auto-map.service';

export type ProductGenderCountsPayload = GenderDistribution & {
  /** Semantics label for UI. */
  semantics: 'non_deleted_catalog' | 'discoverable_storefront';
};

@Injectable()
export class CatMapV2cAdminService {
  constructor(
    @InjectRepository(CanonicalCategoryEntity)
    private readonly canonicalRepository: Repository<CanonicalCategoryEntity>,
    @InjectRepository(SourceCategoryMappingEntity)
    private readonly mappingRepository: Repository<SourceCategoryMappingEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoryRepository: Repository<CategoryEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    @InjectRepository(CategoryAssortmentResolutionEntity)
    private readonly assortmentResolutionRepository: Repository<CategoryAssortmentResolutionEntity>,
    @Optional()
    private readonly assortmentAutoMapService?: AssortmentAutoMapService,
  ) {}

  /**
   * GET detail for one source category — employee mapping workflow payload.
   */
  async getSourceMappingDetailAdmin(sourceCategoryId: number) {
    const category = await this.categoryRepository.findOne({
      where: { id: sourceCategoryId },
      select: [
        'id',
        'name',
        'sourceName',
        'source',
        'sourceId',
        'parentId',
        'status',
      ],
    });
    if (!category || sourceCategoryId <= 1) {
      throw new NotFoundException('دسته‌بندی منبع یافت نشد.');
    }

    const taxonomy = await this.categoryRepository.find({
      select: [
        'id',
        'parentId',
        'source',
        'sourceName',
        'name',
        'status',
        'displayOrder',
      ],
      order: { displayOrder: 'ASC', id: 'ASC' },
    });

    const scopeIds = expandSourceCategoryScopeIds(
      category.id,
      category.source,
      taxonomy,
    );

    const [catalogCounts, discoverableCounts] = await Promise.all([
      this._aggregateGenderCounts(scopeIds, 'catalog'),
      this._aggregateGenderCounts(scopeIds, 'discoverable'),
    ]);

    const mappings = await this.mappingRepository.find({
      where: { sourceCategoryId: category.id },
      order: { genderSlice: 'ASC', id: 'ASC' },
    });

    const canonicals = await this.canonicalRepository.find({
      select: ['id', 'parentId', 'name', 'audience', 'status'],
    });
    const canonicalById = new Map(canonicals.map((c) => [Number(c.id), c]));

    const rules = mappings.map((m) => {
      const canonical = canonicalById.get(Number(m.canonicalCategoryId));
      const root = resolveCanonicalRoot(m.canonicalCategoryId, canonicals);
      return {
        id: m.id,
        genderSlice: m.genderSlice,
        canonicalCategoryId: m.canonicalCategoryId,
        canonicalName: canonical?.name ?? null,
        canonicalPath: buildCanonicalPath(m.canonicalCategoryId, canonicals),
        canonicalAudience: root.rootAudience,
        status: m.status,
        reviewStatus: m.reviewStatus,
        note: m.note,
      };
    });

    const ruleRows: SourceMappingRuleRow[] = rules.map((r) => ({
      genderSlice: r.genderSlice,
      status: r.status,
      reviewStatus: r.reviewStatus,
      canonicalCategoryId: r.canonicalCategoryId,
      canonicalAudience: r.canonicalAudience,
    }));

    // Prefer discoverable distribution for classification / routing (customer impact).
    const destinationRootAudience = pickPrimaryDestinationAudience(ruleRows);
    const classified = classifySourceCategoryScope({
      distribution: discoverableCounts,
      destinationRootAudience,
    });
    const routingStatus = resolveMappingRoutingStatus({
      distribution: discoverableCounts,
      rules: ruleRows,
      classification: classified.classification,
    });

    return {
      sourceCategory: {
        id: category.id,
        name: category.name,
        sourceName: category.sourceName,
        source: category.source,
        sourceId: category.sourceId,
        path: buildSourceCategoryPath(category.id, taxonomy, category.source),
        status: category.status,
        scopeSourceCategoryIds: scopeIds,
        scopeSourceCategoryCount: scopeIds.length,
      },
      /**
       * Primary impact counts = discoverable storefront population
       * (active + A4 + stock/price gates). Prefer this for Mapping UI.
       */
      productCounts: {
        ...discoverableCounts,
        semantics: 'discoverable_storefront' as const,
      },
      catalogCounts: {
        ...catalogCounts,
        semantics: 'non_deleted_catalog' as const,
      },
      discoverableCounts: {
        ...discoverableCounts,
        semantics: 'discoverable_storefront' as const,
      },
      rules,
      classification: classified.classification,
      oppositeShare: classified.oppositeShare,
      matchingShare: classified.matchingShare,
      routingStatus,
      unisexPolicyNote:
        'محصولات یونیسکس به‌صورت پیش‌فرض همراه مسیرهای زنانه/مردانه نمایش داده می‌شوند؛ نیازی به ردیف نگاشت unisex جداگانه نیست.',
    };
  }

  /**
   * Canonical destination picker with full paths.
   * audienceHint ranks only — never hard-filters by source.gender.
   */
  async listCanonicalPickerAdmin(options?: {
    q?: string | null;
    audienceHint?: string | null;
    includeInactive?: boolean;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(Number(options?.limit) || 100, 1), 300);
    const q = options?.q ? String(options.q).trim().toLowerCase() : '';
    const hintRaw = options?.audienceHint
      ? String(options.audienceHint).trim()
      : '';
    const hint = hintRaw ? inferAudienceContext(hintRaw) : 'neutral';
    const includeInactive = !!options?.includeInactive;

    const rows = await this.canonicalRepository.find({
      select: ['id', 'parentId', 'name', 'audience', 'status', 'displayOrder'],
      order: { displayOrder: 'ASC', id: 'ASC' },
    });

    const items = [];
    for (const row of rows) {
      if (!includeInactive && row.status !== CanonicalCategoryStatus.active) {
        continue;
      }
      const path = buildCanonicalPath(row.id, rows);
      const root = resolveCanonicalRoot(row.id, rows);
      if (q) {
        const hay = `${row.name || ''} ${path.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      items.push({
        id: row.id,
        name: row.name,
        path,
        pathLabel: path.join(' / '),
        audience: root.rootAudience,
        audienceField: row.audience,
        status: row.status,
        parentId: row.parentId,
        displayOrder: row.displayOrder,
        selectable: row.status === CanonicalCategoryStatus.active,
      });
    }

    items.sort((a, b) => {
      const aHint =
        hint !== 'neutral' && a.audience === hint
          ? 0
          : a.audience === 'neutral'
          ? 1
          : 2;
      const bHint =
        hint !== 'neutral' && b.audience === hint
          ? 0
          : b.audience === 'neutral'
          ? 1
          : 2;
      if (aHint !== bHint) return aHint - bHint;
      if (a.displayOrder !== b.displayOrder) {
        return a.displayOrder - b.displayOrder;
      }
      return a.id - b.id;
    });

    return {
      items: items.slice(0, limit),
      summary: {
        returned: Math.min(items.length, limit),
        truncated: items.length > limit,
        totalMatched: items.length,
        audienceHint: hint !== 'neutral' ? hint : null,
      },
    };
  }

  /**
   * Atomic V2 save for one source category.
   * Request = desired active V2 rule set (female/male).
   * Deactivates obsolete V2 slices + legacy any after successful upserts.
   */
  async saveSourceMappingV2Admin(
    sourceCategoryId: number,
    input: { rules: V2SaveRuleInput[]; confirmImpact?: boolean },
  ) {
    const category = await this.categoryRepository.findOne({
      where: { id: sourceCategoryId },
      select: ['id', 'source', 'status'],
    });
    if (!category || sourceCategoryId <= 1) {
      throw new SourceCategoryMappingV2ValidationError(
        'دسته‌بندی منبع یافت نشد.',
        'invalid_source',
      );
    }
    if (category.status === CategoryStatus.inactive) {
      throw new SourceCategoryMappingV2ValidationError(
        'دسته‌بندی منبع غیرفعال است.',
        'inactive_source',
      );
    }
    if (!category.source) {
      throw new SourceCategoryMappingV2ValidationError(
        'دسته‌بندی منبع هویت provider ندارد.',
        'invalid_source',
      );
    }

    const taxonomy = await this.categoryRepository.find({
      select: ['id', 'parentId', 'source', 'status', 'displayOrder', 'name'],
    });
    const scopeIds = expandSourceCategoryScopeIds(
      category.id,
      category.source,
      taxonomy,
    );
    const impact = await this._aggregateGenderCounts(scopeIds, 'discoverable');

    const canonicals = await this.canonicalRepository.find({
      select: ['id', 'parentId', 'name', 'audience', 'status'],
    });
    const canonicalById = new Map(canonicals.map((c) => [Number(c.id), c]));

    const validated = validateV2MappingSaveRequest({
      rules: input.rules || [],
      confirmImpact: input.confirmImpact,
      impactProductCount: impact.total,
      allowNeutralAny: false,
      resolveDestination: (canonicalCategoryId) => {
        const row = canonicalById.get(Number(canonicalCategoryId));
        if (!row)
          return { exists: false, active: false, rootAudience: 'neutral' };
        const root = resolveCanonicalRoot(canonicalCategoryId, canonicals);
        return {
          exists: true,
          active: row.status === CanonicalCategoryStatus.active,
          rootAudience: root.rootAudience,
        };
      },
    });

    const existing = await this.mappingRepository.find({
      where: { sourceCategoryId: category.id },
    });
    const hadActiveLegacyAny = existing.some(
      (m) =>
        m.status === SourceCategoryMappingStatus.active &&
        m.genderSlice === SourceCategoryMappingGenderSlice.any &&
        m.reviewStatus === SourceCategoryMappingReviewStatus.legacy_unreviewed,
    );
    const reviewStatus = resolveV2SaveReviewStatus({ hadActiveLegacyAny });
    const requestedSlices = new Set(validated.map((r) => r.genderSlice));

    const saved = await this.mappingRepository.manager.transaction(
      async (manager) => {
        const repo = manager.getRepository(SourceCategoryMappingEntity);
        const results: SourceCategoryMappingEntity[] = [];

        for (const rule of validated) {
          let row = await repo.findOne({
            where: {
              sourceCategoryId: category.id,
              genderSlice: rule.genderSlice,
            },
          });
          if (row) {
            row.canonicalCategoryId = rule.canonicalCategoryId;
            row.source = category.source as string;
            row.status = rule.status;
            row.reviewStatus = reviewStatus;
            row.genderSlice = rule.genderSlice;
          } else {
            row = repo.create({
              sourceCategoryId: category.id,
              canonicalCategoryId: rule.canonicalCategoryId,
              source: category.source as string,
              genderSlice: rule.genderSlice,
              status: rule.status,
              reviewStatus,
              note: null,
              createdAt: dateTime() as any,
            });
          }
          results.push(await repo.save(row));
        }

        const current = await repo.find({
          where: { sourceCategoryId: category.id },
        });

        for (const row of current) {
          const slice = row.genderSlice;
          const isV2Slice =
            slice === SourceCategoryMappingGenderSlice.female ||
            slice === SourceCategoryMappingGenderSlice.male ||
            slice === SourceCategoryMappingGenderSlice.unisex;

          if (
            isV2Slice &&
            !requestedSlices.has(slice as SourceCategoryMappingGenderSlice)
          ) {
            if (row.status !== SourceCategoryMappingStatus.inactive) {
              row.status = SourceCategoryMappingStatus.inactive;
              await repo.save(row);
            }
            continue;
          }

          // Deactivate legacy any so it cannot keep broad V1 routing after V2 transition.
          if (
            slice === SourceCategoryMappingGenderSlice.any &&
            row.status === SourceCategoryMappingStatus.active
          ) {
            row.status = SourceCategoryMappingStatus.inactive;
            row.reviewStatus = SourceCategoryMappingReviewStatus.migrated;
            await repo.save(row);
          }
        }

        return results;
      },
    );

    return {
      sourceCategoryId: category.id,
      reviewStatus,
      impactProductCount: impact.total,
      rules: saved.map((s) => ({
        id: s.id,
        genderSlice: s.genderSlice,
        canonicalCategoryId: s.canonicalCategoryId,
        status: s.status,
        reviewStatus: s.reviewStatus,
      })),
    };
  }

  /**
   * Review queue — paginated, high-impact / mixed first.
   * Distributions use set-based SQL + in-memory scope expansion (no N+1).
   */
  async listMappingReviewQueueAdmin(options?: {
    classification?: string | null;
    routingStatus?: string | null;
    source?: string | null;
    search?: string | null;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(Number(options?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(options?.limit) || 50, 1), 200);
    const sourceFilter = options?.source ? String(options.source).trim() : '';
    const search = options?.search
      ? String(options.search).trim().toLowerCase()
      : '';
    const classificationFilter = options?.classification
      ? String(options.classification).trim()
      : '';
    const routingFilter = options?.routingStatus
      ? String(options.routingStatus).trim()
      : '';

    const [rows, statusById] = await Promise.all([
      this._buildSourceAdminIndex(),
      this._loadAssortmentStatusMap(),
    ]);
    // SCOPE-3/4: mapping review queue is IN_SCOPE only.
    // REVIEW → assortment queue; OUT → hidden (not a mapping failure).
    let filtered = rows.filter((r) =>
      isMappingEligibleStatus(statusById.get(r.sourceCategoryId)),
    );
    if (sourceFilter) {
      filtered = filtered.filter((r) => r.provider === sourceFilter);
    }
    if (search) {
      filtered = filtered.filter((r) => {
        const hay = `${r.sourceName || ''} ${r.sourceFaName || ''} ${
          r.pathLabel
        } ${r.provider || ''}`.toLowerCase();
        return hay.includes(search);
      });
    }
    if (classificationFilter) {
      filtered = filtered.filter(
        (r) => r.classification === classificationFilter,
      );
    }
    if (routingFilter) {
      filtered = filtered.filter((r) => r.routingStatus === routingFilter);
    }

    // High-risk / high-impact first.
    const rank: Record<MappingRoutingStatus, number> = {
      NEEDS_REVIEW: 0,
      PARTIAL: 1,
      UNREVIEWED: 2,
      UNMAPPED: 3,
      COMPLETE: 4,
    };
    filtered.sort((a, b) => {
      const classRank = (c: string) =>
        c === 'MIXED_REVIEW_REQUIRED' ? 0 : c === 'UNKNOWN' ? 1 : 2;
      if (classRank(a.classification) !== classRank(b.classification)) {
        return classRank(a.classification) - classRank(b.classification);
      }
      if (rank[a.routingStatus] !== rank[b.routingStatus]) {
        return rank[a.routingStatus] - rank[b.routingStatus];
      }
      return (
        b.productCounts.total - a.productCounts.total ||
        a.sourceCategoryId - b.sourceCategoryId
      );
    });

    const total = filtered.length;
    const start = (page - 1) * limit;
    const pageItems = filtered.slice(start, start + limit);

    return {
      items: pageItems.map((r) => ({
        ...r,
        assortmentStatus: 'IN_SCOPE',
        assortmentStatusLabel: assortmentStatusLabelFa('IN_SCOPE'),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      assortmentGate: {
        mappingEligibleStatus: 'IN_SCOPE',
        note:
          'صف تطبیق فقط دسته‌های «فعال در فروشگاه» را نشان می‌دهد. موارد «نیازمند تصمیم» در صف تصمیم حوزه فروش هستند.',
      },
    };
  }

  /**
   * Coverage V2 — reviewed/routed metrics distinct from currently-discoverable.
   * SCOPE-3/4 adds assortmentAware (IN-only denominator) without mutating legacy V2 fields.
   */
  async getCategoryCoverageV2Admin() {
    const [index, statusById] = await Promise.all([
      this._buildSourceAdminIndex(),
      this._loadAssortmentStatusMap(),
    ]);
    const taxonomy = await this.categoryRepository.find({
      select: ['id', 'parentId', 'source', 'status', 'displayOrder', 'name'],
    });
    const [canonicals, mappings] = await Promise.all([
      this.canonicalRepository.find({
        select: [
          'id',
          'parentId',
          'status',
          'displayOrder',
          'name',
          'audience',
        ],
      }),
      this.mappingRepository.find(),
    ]);

    const discoverableCatalogProducts = await this._countDiscoverable();

    // Currently discoverable via any active canonical PLP scope (legacy-inclusive).
    const reachable = new Set<number>();
    for (const c of canonicals) {
      if (c.status !== CanonicalCategoryStatus.active) continue;
      const scope = resolveCanonicalCategoryScope(
        c.id,
        canonicals as any,
        mappings as any,
        taxonomy as any,
      );
      for (const id of scope.sourceCategoryIds) reachable.add(id);
    }
    const currentlyDiscoverableViaActiveScopes = reachable.size
      ? await this._countDiscoverableInCategories([...reachable])
      : 0;

    // V2 reviewed slice scopes
    const femaleScope = new Set<number>();
    const maleScope = new Set<number>();
    const adultMappedScope = new Set<number>();

    for (const m of mappings) {
      if (m.status !== SourceCategoryMappingStatus.active) continue;
      const expanded = expandSourceCategoryScopeIds(
        m.sourceCategoryId,
        m.source,
        taxonomy,
      );
      const root = resolveCanonicalRoot(m.canonicalCategoryId, canonicals);
      const isAdultRoot =
        root.rootAudience === 'women' || root.rootAudience === 'men';
      if (isAdultRoot) {
        for (const id of expanded) adultMappedScope.add(id);
      }
      if (
        isReviewedActiveSlice(
          {
            genderSlice: m.genderSlice,
            status: m.status,
            reviewStatus: m.reviewStatus,
            canonicalCategoryId: m.canonicalCategoryId,
          },
          SourceCategoryMappingGenderSlice.female,
        )
      ) {
        for (const id of expanded) femaleScope.add(id);
      }
      if (
        isReviewedActiveSlice(
          {
            genderSlice: m.genderSlice,
            status: m.status,
            reviewStatus: m.reviewStatus,
            canonicalCategoryId: m.canonicalCategoryId,
          },
          SourceCategoryMappingGenderSlice.male,
        )
      ) {
        for (const id of expanded) maleScope.add(id);
      }
    }

    const [v2RoutedFemale, v2RoutedMale, v2RoutedUnisex, unresolvedUnknown] =
      await Promise.all([
        this._countDiscoverableInCategories([...femaleScope], 'female'),
        this._countDiscoverableInCategories([...maleScope], 'male'),
        this._countDiscoverableUnisexInUnion(femaleScope, maleScope),
        this._countDiscoverableInCategories([...adultMappedScope], null),
      ]);

    // Mapping completeness metrics stay IN_SCOPE-only (OUT/REVIEW are not failures).
    const inScopeIndex = index.filter((r) =>
      isMappingEligibleStatus(statusById.get(r.sourceCategoryId)),
    );
    const sourceRows: CoverageSourceCategoryRow[] = inScopeIndex.map((r) => ({
      sourceCategoryId: r.sourceCategoryId,
      routingStatus: r.routingStatus,
      classification: r.classification,
      discoverable: r.productCounts,
      rules: r.ruleRows,
    }));

    const base = buildCoverageV2Summary({
      discoverableCatalogProducts,
      currentlyDiscoverableViaActiveScopes,
      v2RoutedFemale,
      v2RoutedMale,
      v2RoutedUnisexViaAdultSlices: v2RoutedUnisex,
      unresolvedUnknownGenderInAdultMappedScopes: unresolvedUnknown,
      sourceRows,
    });

    const byStatus: Record<
      string,
      { categories: number; discoverableProducts: number }
    > = {
      IN_SCOPE: { categories: 0, discoverableProducts: 0 },
      REVIEW_REQUIRED: { categories: 0, discoverableProducts: 0 },
      OUT_OF_SCOPE: { categories: 0, discoverableProducts: 0 },
    };
    // Own-product discoverable counts by resolved status (matches SCOPE-2 verify).
    const allResolutions = await this.assortmentResolutionRepository.find();
    const ownDisc = await this._discoverableOwnByCategory();
    for (const r of allResolutions) {
      const st = String(r.status);
      if (!byStatus[st]) continue;
      byStatus[st].categories++;
      byStatus[st].discoverableProducts +=
        Number(ownDisc.get(Number(r.categoryId))) || 0;
    }

    // IN_SCOPE_MISSING_DESTINATION = AUTO-MAP NO_DESTINATION tier within IN only.
    const autoMap = this.assortmentAutoMapService
      ? await this.assortmentAutoMapService.computeAdmin()
      : null;
    const inScopeMissingDestination = {
      categories: autoMap?.coverage.categories.inScopeMissingDestination ?? 0,
      discoverableProducts:
        autoMap?.coverage.products.inScopeMissingDestinationProducts ?? 0,
    };

    const legacyClassified = classifyLegacyMappingsByAssortment({
      mappings: mappings.map((m) => ({
        id: Number(m.id),
        sourceCategoryId: Number(m.sourceCategoryId),
      })),
      statusByCategoryId: statusById,
    });

    // REVIEW ancestor leakage: mapped category IN while an ancestor is REVIEW/OUT.
    const taxonomyById = new Map(taxonomy.map((t) => [Number(t.id), t]));
    const leakage: Array<{
      sourceCategoryId: number;
      ancestorCategoryId: number;
      ancestorStatus: string;
    }> = [];
    for (const m of mappings) {
      if (m.status !== SourceCategoryMappingStatus.active) continue;
      let cur = taxonomyById.get(Number(m.sourceCategoryId));
      const seen = new Set<number>();
      while (cur?.parentId != null && !seen.has(Number(cur.id))) {
        seen.add(Number(cur.id));
        const parentId = Number(cur.parentId);
        const pst = statusById.get(parentId);
        if (pst === 'REVIEW_REQUIRED' || pst === 'OUT_OF_SCOPE') {
          leakage.push({
            sourceCategoryId: Number(m.sourceCategoryId),
            ancestorCategoryId: parentId,
            ancestorStatus: pst,
          });
          break;
        }
        cur = taxonomyById.get(parentId);
      }
    }

    return {
      ...base,
      assortmentAware: buildAssortmentAwareCoverage({
        totalDiscoverable: discoverableCatalogProducts,
        byStatus,
        inScopeMissingDestination,
        autoMapHighRoutable: autoMap?.coverage.products.autoMapHighRoutable,
        autoMapHighSuggestRoutable:
          autoMap?.coverage.products.autoMapHighSuggestRoutable,
      }),
      legacyMappingsByAssortment: {
        byStatus: {
          IN_SCOPE: legacyClassified.byStatus.IN_SCOPE.count,
          REVIEW_REQUIRED: legacyClassified.byStatus.REVIEW_REQUIRED.count,
          OUT_OF_SCOPE: legacyClassified.byStatus.OUT_OF_SCOPE.count,
        },
        unresolvableCount: legacyClassified.unresolvable.length,
        note: 'Legacy mapping rows are reported only — not mutated or deactivated.',
      },
      reviewAncestorLeakage: {
        count: leakage.length,
        samples: leakage.slice(0, 20),
        note: 'Informational. Scope expansion / ancestor leakage is not enforced in SCOPE-3/4.',
      },
    };
  }

  // ─── internals ───────────────────────────────────────────────────────────

  private async _loadAssortmentStatusMap(): Promise<Map<number, string>> {
    const rows = await this.assortmentResolutionRepository.find({
      select: ['categoryId', 'status'],
    });
    return new Map(
      rows.map((r) => [Number(r.categoryId), String(r.status)]),
    );
  }

  private async _discoverableOwnByCategory(): Promise<Map<number, number>> {
    const rows = await this.productRepository
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
    return new Map(rows.map((r) => [Number(r.categoryId), Number(r.n)]));
  }

  private async _aggregateGenderCounts(
    categoryIds: number[],
    mode: 'catalog' | 'discoverable',
  ): Promise<GenderDistribution> {
    if (!categoryIds.length) return emptyDistribution();
    const qb = this.productRepository
      .createQueryBuilder('p')
      .select('p.gender', 'gender')
      .addSelect('COUNT(*)', 'count')
      .where('p.categoryId IN (:...ids)', { ids: categoryIds })
      .andWhere('p.isDeleted = 0');

    if (mode === 'discoverable') {
      qb.andWhere('p.status = :status', { status: ProductStatus.active })
        .andWhere('p.price > 0')
        .andWhere('p.categoryId != 1')
        .andWhere(discoveryEligibilitySql('p'));
    }

    const rows = await qb.groupBy('p.gender').getRawMany();
    return distributionFromGenderRows(rows);
  }

  private async _countDiscoverable(): Promise<number> {
    return this.productRepository
      .createQueryBuilder('p')
      .where('p.isDeleted = 0')
      .andWhere('p.status = :status', { status: ProductStatus.active })
      .andWhere('p.price > 0')
      .andWhere('p.categoryId != 1')
      .andWhere(discoveryEligibilitySql('p'))
      .getCount();
  }

  private async _countDiscoverableInCategories(
    categoryIds: number[],
    gender?: 'female' | 'male' | null,
  ): Promise<number> {
    if (!categoryIds.length) return 0;
    const qb = this.productRepository
      .createQueryBuilder('p')
      .where('p.isDeleted = 0')
      .andWhere('p.status = :status', { status: ProductStatus.active })
      .andWhere('p.price > 0')
      .andWhere('p.categoryId != 1')
      .andWhere('p.categoryId IN (:...ids)', { ids: categoryIds })
      .andWhere(discoveryEligibilitySql('p'));
    if (gender === null) {
      qb.andWhere('p.gender IS NULL');
    } else if (gender) {
      qb.andWhere('p.gender = :gender', { gender });
    }
    return qb.getCount();
  }

  private async _countDiscoverableUnisexInUnion(
    femaleScope: Set<number>,
    maleScope: Set<number>,
  ): Promise<number> {
    const union = [...new Set([...femaleScope, ...maleScope])];
    if (!union.length) return 0;
    return this.productRepository
      .createQueryBuilder('p')
      .where('p.isDeleted = 0')
      .andWhere('p.status = :status', { status: ProductStatus.active })
      .andWhere('p.price > 0')
      .andWhere('p.categoryId != 1')
      .andWhere('p.categoryId IN (:...ids)', { ids: union })
      .andWhere("p.gender = 'unisex'")
      .andWhere(discoveryEligibilitySql('p'))
      .getCount();
  }

  /**
   * One-shot index for review queue + coverage source metrics.
   * Loads taxonomy/mappings once; aggregates product genders in 2 SQL group-bys.
   */
  private async _buildSourceAdminIndex(): Promise<
    Array<{
      sourceCategoryId: number;
      sourceName: string | null;
      sourceFaName: string | null;
      provider: string | null;
      providerSourceId: string | null;
      path: string[];
      pathLabel: string;
      productCounts: GenderDistribution;
      catalogCounts: GenderDistribution;
      classification: string;
      routingStatus: MappingRoutingStatus;
      destinationSummary: string | null;
      ruleRows: SourceMappingRuleRow[];
    }>
  > {
    const [taxonomy, mappings, canonicals, catalogRows, discoverableRows] =
      await Promise.all([
        this.categoryRepository.find({
          select: [
            'id',
            'parentId',
            'source',
            'sourceName',
            'name',
            'sourceId',
            'status',
            'displayOrder',
          ],
        }),
        this.mappingRepository.find(),
        this.canonicalRepository.find({
          select: ['id', 'parentId', 'name', 'audience', 'status'],
        }),
        this.productRepository
          .createQueryBuilder('p')
          .select('p.categoryId', 'categoryId')
          .addSelect('p.gender', 'gender')
          .addSelect('COUNT(*)', 'count')
          .where('p.isDeleted = 0')
          .andWhere('p.categoryId > 1')
          .groupBy('p.categoryId')
          .addGroupBy('p.gender')
          .getRawMany(),
        this.productRepository
          .createQueryBuilder('p')
          .select('p.categoryId', 'categoryId')
          .addSelect('p.gender', 'gender')
          .addSelect('COUNT(*)', 'count')
          .where('p.isDeleted = 0')
          .andWhere('p.status = :status', { status: ProductStatus.active })
          .andWhere('p.price > 0')
          .andWhere('p.categoryId > 1')
          .andWhere(discoveryEligibilitySql('p'))
          .groupBy('p.categoryId')
          .addGroupBy('p.gender')
          .getRawMany(),
      ]);

    const catalogByCat = this._indexGenderRows(catalogRows);
    const discByCat = this._indexGenderRows(discoverableRows);
    const mappingsBySource = new Map<number, SourceCategoryMappingEntity[]>();
    for (const m of mappings) {
      const sid = Number(m.sourceCategoryId);
      const list = mappingsBySource.get(sid) || [];
      list.push(m);
      mappingsBySource.set(sid, list);
    }

    // Candidate source categories: mapped OR have discoverable products.
    const candidateIds = new Set<number>();
    for (const id of mappingsBySource.keys()) candidateIds.add(id);
    for (const id of discByCat.keys()) candidateIds.add(id);

    const taxonomyById = new Map(taxonomy.map((t) => [Number(t.id), t]));
    const out = [];

    for (const sid of candidateIds) {
      if (sid <= 1) continue;
      const cat = taxonomyById.get(sid);
      if (!cat) continue;

      const scopeIds = expandSourceCategoryScopeIds(sid, cat.source, taxonomy);
      const discoverable = this._sumScoped(scopeIds, discByCat);
      const catalog = this._sumScoped(scopeIds, catalogByCat);
      if (discoverable.total <= 0 && !mappingsBySource.has(sid)) continue;

      const maps = mappingsBySource.get(sid) || [];
      const ruleRows: SourceMappingRuleRow[] = maps.map((m) => {
        const root = resolveCanonicalRoot(m.canonicalCategoryId, canonicals);
        return {
          genderSlice: m.genderSlice,
          status: m.status,
          reviewStatus: m.reviewStatus,
          canonicalCategoryId: m.canonicalCategoryId,
          canonicalAudience: root.rootAudience,
        };
      });

      const destinationRootAudience = pickPrimaryDestinationAudience(ruleRows);
      const classified = classifySourceCategoryScope({
        distribution: discoverable,
        destinationRootAudience,
      });
      const routingStatus = resolveMappingRoutingStatus({
        distribution: discoverable,
        rules: ruleRows,
        classification: classified.classification,
      });

      const activeRules = maps.filter(
        (m) => m.status === SourceCategoryMappingStatus.active,
      );
      const destinationSummary =
        activeRules
          .map((m) => {
            const path = buildCanonicalPath(m.canonicalCategoryId, canonicals);
            return `${m.genderSlice}→${path.join('/')}`;
          })
          .join('; ') || null;

      const path = buildSourceCategoryPath(sid, taxonomy, cat.source);
      out.push({
        sourceCategoryId: sid,
        sourceName: cat.sourceName,
        sourceFaName: cat.name,
        provider: cat.source,
        providerSourceId: cat.sourceId,
        path,
        pathLabel: path.join(' → '),
        productCounts: discoverable,
        catalogCounts: catalog,
        classification: classified.classification,
        routingStatus,
        destinationSummary,
        ruleRows,
      });
    }

    return out;
  }

  private _indexGenderRows(
    rows: Array<{ categoryId: number; gender: string | null; count: string }>,
  ): Map<number, Array<{ gender: string | null; count: number }>> {
    const map = new Map<
      number,
      Array<{ gender: string | null; count: number }>
    >();
    for (const row of rows) {
      const id = Number(row.categoryId);
      const list = map.get(id) || [];
      list.push({ gender: row.gender, count: Number(row.count) || 0 });
      map.set(id, list);
    }
    return map;
  }

  private _sumScoped(
    scopeIds: number[],
    byCat: Map<number, Array<{ gender: string | null; count: number }>>,
  ): GenderDistribution {
    const dist = emptyDistribution();
    for (const id of scopeIds) {
      const rows = byCat.get(id);
      if (!rows) continue;
      const part = distributionFromGenderRows(rows);
      dist.total += part.total;
      dist.female += part.female;
      dist.male += part.male;
      dist.unisex += part.unisex;
      dist.unknown += part.unknown;
    }
    return dist;
  }
}
