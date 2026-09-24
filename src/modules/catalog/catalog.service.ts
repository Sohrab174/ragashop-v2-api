import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder, In } from 'typeorm';
import {
  CanonicalCategoryEntity,
  CanonicalCategoryStatus,
} from './entities/canonical-category.entity';
import {
  SourceCategoryMappingEntity,
  SourceCategoryMappingStatus,
} from './entities/source-category-mapping.entity';
import {
  prepareStorefrontNavigationTree,
  StorefrontNavigationNode,
} from './canonical-tree.builder';
import {
  CanonicalHierarchyValidationError,
  validateCanonicalParentAssignment,
} from './canonical-hierarchy.validation';
import {
  applyResolvedImages,
  normalizeCategoryLabel,
  resolveCanonicalPresentationImages,
} from './canonical-presentation-image';
import {
  SourceCategoryMappingValidationError,
  validateSourceCategoryMappingWrite,
} from './source-category-mapping.validation';
import {
  resolveCanonicalCategoryScope,
  CanonicalCategoryScopeResult,
} from './canonical-category-scope.resolver';
import { applyDiscoveryEligibilityFilters } from '../product/discovery-eligibility';
import {
  applyStorefrontDiscountDiscoveryFilter,
  applyStorefrontPlpSort,
  STOREFRONT_EFFECTIVE_PRICE_SQL,
  STOREFRONT_VISIBLE_DISCOUNT_SQL,
  StorefrontPlpQuery,
} from './storefront-plp.query';
import {
  applyStorefrontPlpFilters,
  isExcludedFilterAttributeName,
  sanitizeStorefrontPlpAttributeOwnership,
  STOREFRONT_PLP_EXCLUDED_ATTRIBUTE_NAMES,
  STOREFRONT_PLP_MAX_BRAND_FACETS,
  STOREFRONT_PLP_MAX_FACET_ATTRIBUTES,
  STOREFRONT_PLP_MAX_VALUE_NAME_LENGTH,
  toAppliedStorefrontPlpFilters,
  tryPriceToToman,
  type StorefrontPlpAttributeFacet,
  type StorefrontPlpBrandFacet,
  type StorefrontPlpFilters,
  type StorefrontPlpFiltersPayload,
  type StorefrontPlpPriceFacet,
} from './storefront-plp.filters';
import {
  buildStorefrontPlpFacetCacheKey,
  getStorefrontPlpFacetCache,
  setStorefrontPlpFacetCache,
} from './storefront-plp-facet-cache';
import {
  buildEmptyStorefrontPlpResponse,
  buildStorefrontPlpPagination,
  mapStorefrontPlpProduct,
  StorefrontPlpResponse,
} from './storefront-plp.mapper';
import {
  buildCanonicalBreadcrumbTrail,
  compactBreadcrumbTrail,
} from './storefront-pdp.breadcrumb';
import {
  normalizePdpSourceKey,
  resolvePdpBreadcrumbRequiredSource,
} from './storefront-pdp.source-isolation';
import { mapStorefrontPdpProduct } from './storefront-pdp.mapper';
import type { StorefrontPdpProduct } from './storefront-pdp.types';
import { dateTime } from '../../utils';
import {
  CategoryEntity,
  CategoryStatus,
} from '../category/entities/category.entity';
import {
  ProductEntity,
  ProductGender,
  ProductStatus,
} from '../product/entities/product.entity';
import {
  eligibleProductGendersForAudience,
  isAdultAudienceBrowse,
  resolveCanonicalBrowseAudience,
} from './canonical-audience-policy';
import {
  ProductGalleryEntity,
  ProductGalleryType,
} from '../product/entities/product-gallery.entity';
import { ProductDescriptionEntity } from '../product/entities/product-description.entity';
import { ProductAttributeValueEntity } from '../product/entities/product-attribute-value.entity';
import { SettingService } from '../setting/setting.service';

/**
 * Public Product Listing eligibility — ProductService.getAll + A4 discovery:
 * - product.status = active
 * - product.isDeleted = false
 * - product.price > 0
 * - product.categoryId != 1
 * - category.status = active (INNER JOIN)
 * - A4 discovery: curated external not unavailable/removed;
 *   non-curated external excluded; native/unclassified compatible
 * Not required: isSellable, hasStock, quantity; source_error alone never hides
 * PDP does NOT require curated membership (paste-link direct access).
 */

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(CanonicalCategoryEntity)
    private readonly canonicalRepository: Repository<CanonicalCategoryEntity>,
    @InjectRepository(SourceCategoryMappingEntity)
    private readonly mappingRepository: Repository<SourceCategoryMappingEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    @InjectRepository(ProductGalleryEntity)
    private readonly galleryRepository: Repository<ProductGalleryEntity>,
    @InjectRepository(ProductDescriptionEntity)
    private readonly descriptionRepository: Repository<ProductDescriptionEntity>,
    @InjectRepository(ProductAttributeValueEntity)
    private readonly productAttributeValueRepository: Repository<ProductAttributeValueEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoryRepository: Repository<CategoryEntity>,
    private readonly settingService: SettingService,
  ) {}

  /**
   * Public storefront navigation tree from active canonical categories.
   * Does not expose source/import metadata.
   */
  async getStorefrontNavigation(): Promise<StorefrontNavigationNode[]> {
    const rows = await this.canonicalRepository.find({
      where: { status: CanonicalCategoryStatus.active },
      select: [
        'id',
        'parentId',
        'name',
        'imagePath',
        'discoveryImagePath',
        'audience',
        'displayOrder',
      ],
      order: { displayOrder: 'ASC', id: 'ASC' },
    });

    const flat = rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      imagePath: row.imagePath,
      discoveryImagePath: row.discoveryImagePath,
      audience: row.audience,
      displayOrder: row.displayOrder,
    }));

    const withImages = await this._enrichPresentationImages(flat);
    return prepareStorefrontNavigationTree(withImages);
  }

  /**
   * Bounded read-only image enrichment:
   * mappings → source icons → product covers → descendant inherit.
   * Fixed query count (does not scale with card count as N+1).
   */
  private async _enrichPresentationImages(
    flat: Array<{
      id: number;
      parentId: number | null;
      name: string;
      imagePath?: string | null;
      discoveryImagePath?: string | null;
      audience?: string | null;
      displayOrder?: number;
    }>,
  ) {
    if (!flat.length) {
      return flat.map((row) => ({ ...row, imagePath: row.imagePath ?? null }));
    }

    const mappings = await this.mappingRepository.find({
      where: { status: SourceCategoryMappingStatus.active },
      select: ['id', 'source', 'canonicalCategoryId', 'sourceCategoryId'],
      order: { source: 'ASC', sourceCategoryId: 'ASC', id: 'ASC' },
    });

    const sourceIds = [
      ...new Set(
        [...mappings]
          .sort((a, b) => {
            const s = String(a.source || '').localeCompare(
              String(b.source || ''),
              'en',
            );
            if (s !== 0) return s;
            return a.sourceCategoryId - b.sourceCategoryId;
          })
          .map((m) => Number(m.sourceCategoryId)),
      ),
    ].sort((a, b) => a - b);

    let sourceTaxonomy: Array<{
      id: number;
      parentId: number | null;
      iconPath: string | null;
      displayOrder: number | null;
      name: string | null;
    }> = [];
    let productCovers: Array<{ categoryId: number; pathFile: string }> = [];

    if (sourceIds.length) {
      const manager = this.canonicalRepository.manager;

      sourceTaxonomy = await manager.find(CategoryEntity, {
        where: { status: CategoryStatus.active },
        select: ['id', 'parentId', 'iconPath', 'displayOrder', 'name'],
      });

      const byParentRows = new Map<number | null, CategoryEntity[]>();
      for (const row of sourceTaxonomy) {
        const key = row.parentId == null ? null : Number(row.parentId);
        const list = byParentRows.get(key) || [];
        list.push(row as any);
        byParentRows.set(key, list);
      }

      const childrenByParent = new Map<number | null, number[]>();
      for (const [key, list] of byParentRows) {
        list.sort((a, b) => {
          const orderA = a.displayOrder ?? 0;
          const orderB = b.displayOrder ?? 0;
          if (orderA !== orderB) return orderA - orderB;
          if (a.id !== b.id) return a.id - b.id;
          return String(a.name || '').localeCompare(String(b.name || ''), 'fa');
        });
        childrenByParent.set(
          key,
          list.map((r) => r.id),
        );
      }

      const coverLookupIds: number[] = [];
      const coverSeen = new Set<number>();

      // Presentation name-match: UNIQUE(sourceCategoryId) leaves parallel
      // leaves unmapped — still need covers for exact/normalized label hits.
      const nameMatchedSourceIds: number[] = [];
      const exactNameToIds = new Map<string, number[]>();
      const normNameToIds = new Map<string, number[]>();
      for (const row of sourceTaxonomy) {
        const label = String(row.name || '').trim();
        if (!label) continue;
        const exactList = exactNameToIds.get(label) || [];
        exactList.push(row.id);
        exactNameToIds.set(label, exactList);
        const normalized = normalizeCategoryLabel(label);
        if (!normalized) continue;
        const normList = normNameToIds.get(normalized) || [];
        normList.push(row.id);
        normNameToIds.set(normalized, normList);
      }
      for (const canonical of flat) {
        const label = String(canonical.name || '').trim();
        if (!label) continue;
        for (const id of exactNameToIds.get(label) || []) {
          nameMatchedSourceIds.push(id);
        }
        const normalized = normalizeCategoryLabel(label);
        if (normalized) {
          for (const id of normNameToIds.get(normalized) || []) {
            nameMatchedSourceIds.push(id);
          }
        }
        const andPrefix = `${label} و`;
        for (const row of sourceTaxonomy) {
          const sourceName = String(row.name || '').trim();
          if (sourceName.startsWith(andPrefix)) {
            nameMatchedSourceIds.push(row.id);
          }
        }
      }

      const lookupRoots = [
        ...new Set([...sourceIds, ...nameMatchedSourceIds]),
      ].sort((a, b) => a - b);

      for (const sourceId of lookupRoots) {
        const queue = [sourceId];
        const seen = new Set<number>();
        while (queue.length && coverLookupIds.length < 2000) {
          const id = queue.shift()!;
          if (seen.has(id)) continue;
          seen.add(id);
          if (!coverSeen.has(id)) {
            coverSeen.add(id);
            coverLookupIds.push(id);
          }
          for (const childId of childrenByParent.get(id) || []) {
            if (!seen.has(childId)) queue.push(childId);
          }
        }
      }

      productCovers = await this._fetchProductCoversForCategories(
        coverLookupIds,
      );
    }

    const imageById = resolveCanonicalPresentationImages(
      flat,
      mappings.map((m) => ({
        id: m.id,
        source: m.source,
        canonicalCategoryId: m.canonicalCategoryId,
        sourceCategoryId: m.sourceCategoryId,
      })),
      sourceTaxonomy,
      productCovers,
    );

    return applyResolvedImages(flat, imageById);
  }

  private async _fetchProductCoversForCategories(categoryIds: number[]) {
    if (!categoryIds.length) {
      return [];
    }

    const coverQb = this.canonicalRepository.manager
      .createQueryBuilder()
      .select('p.categoryId', 'categoryId')
      .addSelect('pg.pathFile', 'pathFile')
      .from(ProductEntity, 'p')
      .innerJoin(
        ProductGalleryEntity,
        'pg',
        'pg.id = p.coverId AND pg.type = :galleryType',
        { galleryType: ProductGalleryType.photo },
      )
      .where('p.categoryId IN (:...categoryIds)', { categoryIds })
      .andWhere('p.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('p.status = :status', { status: ProductStatus.active })
      .andWhere('p.coverId IS NOT NULL');
    applyDiscoveryEligibilityFilters(coverQb as any, 'p');
    const rows = await coverQb
      .orderBy('p.categoryId', 'ASC')
      .addOrderBy('pg.pathFile', 'ASC')
      .addOrderBy('p.id', 'ASC')
      .getRawMany();

    const seen = new Set<number>();
    const result: { categoryId: number; pathFile: string }[] = [];
    for (const row of rows) {
      const categoryId = Number(row.categoryId);
      if (seen.has(categoryId)) continue;
      seen.add(categoryId);
      if (row.pathFile) {
        result.push({ categoryId, pathFile: row.pathFile });
      }
    }
    return result;
  }

  async assertValidParent(
    categoryId: number | null | undefined,
    parentId: number | null | undefined,
  ): Promise<void> {
    await validateCanonicalParentAssignment(
      this.canonicalRepository,
      categoryId,
      parentId,
    );
  }

  async getMappedSourceCategoryIds(
    canonicalCategoryId: number,
  ): Promise<number[]> {
    const mappings = await this.mappingRepository.find({
      where: {
        canonicalCategoryId,
        status: SourceCategoryMappingStatus.active,
      },
      select: ['sourceCategoryId'],
      order: { sourceCategoryId: 'ASC' },
    });
    return mappings.map((m) => m.sourceCategoryId);
  }

  /**
   * Authoritative canonical → source category scope for Product Listing.
   * Explicit active mappings only; empty source set when unmapped.
   */
  async resolveCanonicalCategoryScope(
    canonicalCategoryId: number,
  ): Promise<CanonicalCategoryScopeResult> {
    const [canonicalRows, mappings, sourceTaxonomy] = await Promise.all([
      this.canonicalRepository.find({
        select: ['id', 'parentId', 'status', 'displayOrder', 'name'],
        order: { displayOrder: 'ASC', id: 'ASC' },
      }),
      this.mappingRepository.find({
        select: [
          'id',
          'canonicalCategoryId',
          'sourceCategoryId',
          'status',
          'source',
        ],
        order: { source: 'ASC', sourceCategoryId: 'ASC', id: 'ASC' },
      }),
      this.canonicalRepository.manager.find(CategoryEntity, {
        select: ['id', 'parentId', 'source', 'status', 'displayOrder', 'name'],
        order: { displayOrder: 'ASC', id: 'ASC' },
      }),
    ]);

    return resolveCanonicalCategoryScope(
      canonicalCategoryId,
      canonicalRows.map((row) => ({
        id: row.id,
        parentId: row.parentId,
        status: row.status,
        displayOrder: row.displayOrder,
        name: row.name,
      })),
      mappings.map((m) => ({
        id: m.id,
        canonicalCategoryId: m.canonicalCategoryId,
        sourceCategoryId: m.sourceCategoryId,
        status: m.status,
        source: m.source,
      })),
      sourceTaxonomy.map((row) => ({
        id: row.id,
        parentId: row.parentId,
        source: row.source,
        status: row.status,
        displayOrder: row.displayOrder,
        name: row.name,
      })),
    );
  }

  /**
   * GET /catalog/products — canonical-aware storefront Product Listing + facets.
   * `query.categoryId` is a CANONICAL category id.
   *
   * Query plan (bounded, set-based — not N+1 per facet value):
   * 1) load canonical rows + mappings + source taxonomy (3 queries)
   * 2) resolve scope in memory
   * 3) tryToToman setting read
   * 4) filtered product page + count in parallel with facet queries
   * 5) brand facet, price facet, attribute facets (set-based; ≤1 value-count
   *    query per distinct self-exclusion context — not per value)
   */
  async getStorefrontProducts(
    query: StorefrontPlpQuery,
  ): Promise<StorefrontPlpResponse> {
    const category = await this.canonicalRepository.findOne({
      where: {
        id: query.categoryId,
        status: CanonicalCategoryStatus.active,
      },
      select: ['id', 'name'],
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const scope = await this.resolveCanonicalCategoryScope(category.id);
    const categoryPayload = { id: category.id, name: category.name };

    if (!scope.sourceCategoryIds.length) {
      return buildEmptyStorefrontPlpResponse(
        categoryPayload,
        query.page,
        query.limit,
        query.filters,
      );
    }

    // CAT-3B — adult audience roots: structural scope ∩ product.gender
    const audienceGenders = await this._resolveAdultAudienceGenders(
      category.id,
    );

    const tryToToman = await this.settingService.getTryToToman();
    const sourceCategoryIds = scope.sourceCategoryIds;
    const filters = await this._sanitizeStorefrontPlpFilters(query.filters);

    const listingBuilder = this._buildEligibleProductBuilder(
      sourceCategoryIds,
      audienceGenders,
    )
      .leftJoinAndSelect('product.cover', 'cover')
      .leftJoinAndSelect('product.brand', 'brand')
      .addSelect(STOREFRONT_EFFECTIVE_PRICE_SQL, 'mainPrice')
      .addSelect(STOREFRONT_VISIBLE_DISCOUNT_SQL, 'visibleDiscount');

    applyStorefrontPlpFilters(listingBuilder, filters, tryToToman);
    if (query.sort === 'discount') {
      applyStorefrontDiscountDiscoveryFilter(listingBuilder);
    }
    applyStorefrontPlpSort(listingBuilder, query.sort);

    // Facets are independent of page/sort — reuse when filters+scope unchanged.
    const facetCacheKey = buildStorefrontPlpFacetCacheKey({
      sourceCategoryIds,
      filters,
      tryToToman,
      audienceGenders,
    });
    const cachedFacets = getStorefrontPlpFacetCache(facetCacheKey);

    const [[rows, total], filtersPayload] = await Promise.all([
      listingBuilder
        .take(query.limit)
        .skip((query.page - 1) * query.limit)
        .getManyAndCount(),
      cachedFacets
        ? Promise.resolve(cachedFacets)
        : this._buildStorefrontFacets(
            sourceCategoryIds,
            filters,
            tryToToman,
            audienceGenders,
          ).then((payload) => {
            setStorefrontPlpFacetCache(facetCacheKey, payload);
            return payload;
          }),
    ]);

    return {
      category: categoryPayload,
      items: rows.map((row) => mapStorefrontPlpProduct(row, tryToToman)),
      pagination: buildStorefrontPlpPagination(query.page, query.limit, total),
      filters: filtersPayload,
      appliedFilters: toAppliedStorefrontPlpFilters(filters),
    };
  }

  /**
   * Storefront Product Detail (PDP-1).
   *
   * Core visibility only (active, not deleted, price > 0, not stub category):
   * does NOT require curated discovery membership — paste-link / direct URL OK.
   * Does NOT suppress confirmed unavailable (PDP may show unavailable state).
   * Purchasability is modeled separately (availability.purchasable).
   *
   * Bounded parallel loads — no N+1 for gallery / descriptions / PAVs / siblings.
   */
  async getStorefrontProductDetail(
    productId: number,
  ): Promise<StorefrontPdpProduct> {
    const product = await this.productRepository
      .createQueryBuilder('product')
      .innerJoinAndSelect(
        'product.category',
        'category',
        'category.status = :catStatus',
        { catStatus: CategoryStatus.active },
      )
      .leftJoinAndSelect('product.cover', 'cover')
      .leftJoinAndSelect('product.brand', 'brand')
      .andWhere('product.id = :productId', { productId })
      .andWhere('product.status = :status', { status: ProductStatus.active })
      .andWhere('product.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('product.price > 0')
      .andWhere('product.categoryId != 1')
      .getOne();

    if (!product) {
      throw new NotFoundException('محصول مورد نظر یافت نشد.');
    }

    const tryToTomanPromise = this.settingService.getTryToToman();

    const galleriesPromise = this.galleryRepository.find({
      where: { productId },
      select: ['id', 'pathFile', 'type'],
      order: { id: 'ASC' },
    });

    const descriptionsPromise = this.descriptionRepository.find({
      where: { productId, isDeleted: false },
      select: ['id', 'content', 'sourceContent', 'displayOrder', 'isDeleted'],
      order: { displayOrder: 'ASC', id: 'ASC' },
    });

    const pavsPromise = this.productAttributeValueRepository.find({
      where: { productId, isDeleted: false },
      relations: ['attributeValue', 'attributeValue.attribute'],
      order: { id: 'ASC' },
    });

    const siblingsPromise = this._loadPdpSiblings(product);

    const breadcrumbPromise = this._resolvePdpBreadcrumb(
      product.categoryId,
      product.source,
    );

    const [tryToToman, galleries, descriptions, pavs, siblings, breadcrumb] =
      await Promise.all([
        tryToTomanPromise,
        galleriesPromise,
        descriptionsPromise,
        pavsPromise,
        siblingsPromise,
        breadcrumbPromise,
      ]);

    product.productGalleries = galleries;
    product.productDescriptions = descriptions;
    product.productAttributeValues = pavs;

    return mapStorefrontPdpProduct(product, tryToToman, breadcrumb, siblings);
  }

  /**
   * Bounded same-source siblings for PDP (sourceGroupId + authoritative source).
   * Does not expose source / sourceGroupId on the public response.
   */
  private async _loadPdpSiblings(
    product: ProductEntity,
  ): Promise<ProductEntity[]> {
    const sourceGroupId = String(product.sourceGroupId ?? '').trim();
    const source = normalizePdpSourceKey(product.source);
    if (!sourceGroupId || !source) return [];

    return this.productRepository
      .createQueryBuilder('sibling')
      .leftJoinAndSelect('sibling.cover', 'siblingCover')
      .innerJoin(
        'sibling.category',
        'siblingCategory',
        'siblingCategory.status = :catStatus',
        { catStatus: CategoryStatus.active },
      )
      .andWhere('sibling.sourceGroupId = :sourceGroupId', { sourceGroupId })
      .andWhere('sibling.source = :source', { source: product.source })
      .andWhere('sibling.id != :productId', { productId: product.id })
      .andWhere('sibling.status = :status', {
        status: ProductStatus.active,
      })
      .andWhere('sibling.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('sibling.price > 0')
      .andWhere('sibling.categoryId != 1')
      .orderBy('sibling.id', 'ASC')
      .take(12)
      .getMany();
  }

  /**
   * Canonical breadcrumb via source→canonical mapping.
   * Walks the product's source category ancestors until an active mapping
   * is found (PLP often attaches products to unmapped leaf source categories
   * under a mapped root). Empty when no mapped ancestor exists.
   *
   * Ancestor walk never crosses a null/empty or different retailer source.
   */
  private async _resolvePdpBreadcrumb(
    sourceCategoryId: number | null | undefined,
    productSource?: string | null,
  ) {
    if (sourceCategoryId == null || sourceCategoryId <= 1) return [];

    const startCategory = await this.categoryRepository.findOne({
      where: { id: sourceCategoryId },
      select: ['id', 'source'],
    });
    const requiredSource = resolvePdpBreadcrumbRequiredSource(
      productSource,
      startCategory?.source,
    );

    const ancestorIds = await this._collectSourceCategoryAncestorIds(
      sourceCategoryId,
      requiredSource,
    );
    if (!ancestorIds.length) return [];

    const mappings = await this.mappingRepository.find({
      where: {
        sourceCategoryId: In(ancestorIds),
        status: SourceCategoryMappingStatus.active,
      },
      select: ['sourceCategoryId', 'canonicalCategoryId'],
    });

    if (!mappings.length) return [];

    const mappingBySource = new Map(
      mappings.map((m) => [m.sourceCategoryId, m.canonicalCategoryId]),
    );

    // Prefer the nearest mapped ancestor (leaf → root order in ancestorIds).
    let canonicalId: number | null = null;
    for (const id of ancestorIds) {
      const hit = mappingBySource.get(id);
      if (hit) {
        canonicalId = hit;
        break;
      }
    }
    if (canonicalId == null) return [];

    const rows = await this.canonicalRepository.find({
      where: { status: CanonicalCategoryStatus.active },
      select: ['id', 'parentId', 'name', 'status'],
    });

    const byId = new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          parentId: r.parentId,
          name: r.name,
          status: r.status,
        },
      ]),
    );

    const trail = buildCanonicalBreadcrumbTrail(canonicalId, byId);
    return compactBreadcrumbTrail(trail, 3);
  }

  /**
   * sourceCategoryId first, then same-source parents up to stub/root.
   * Stops at null/empty or cross-source parent boundaries. Bounded + cycle-safe.
   */
  private async _collectSourceCategoryAncestorIds(
    sourceCategoryId: number,
    requiredSource: string | null,
  ): Promise<number[]> {
    const ids: number[] = [];
    let current: number | null = sourceCategoryId;
    const seen = new Set<number>();

    while (current != null && current > 1 && ids.length < 12) {
      if (seen.has(current)) break;

      const row:
        | { id: number; parentId: number | null; source: string | null }
        | undefined = await this.categoryRepository.findOne({
        where: { id: current },
        select: ['id', 'parentId', 'source'],
      });
      if (!row) break;

      // Start category is always included; parents must match requiredSource.
      if (ids.length > 0) {
        if (!requiredSource) break;
        if (normalizePdpSourceKey(row.source) !== requiredSource) break;
      }

      seen.add(current);
      ids.push(current);
      current = row.parentId != null ? Number(row.parentId) : null;
    }

    return ids;
  }

  /**
   * CAT-3B — resolve adult audience gender filter for a canonical category.
   * Returns null for kids/neutral (no gender intersection; structural only).
   */
  private async _resolveAdultAudienceGenders(
    canonicalCategoryId: number,
  ): Promise<ProductGender[] | null> {
    const rows = await this.canonicalRepository.find({
      select: ['id', 'parentId', 'name', 'audience'],
    });
    const audience = resolveCanonicalBrowseAudience(canonicalCategoryId, rows);
    if (!isAdultAudienceBrowse(audience)) return null;
    return eligibleProductGendersForAudience(audience);
  }

  /**
   * Shared eligible Product population for listing + facets (PLP-1 + A4 discovery).
   * CAT-3B: optional audienceGenders intersects product.gender before pagination.
   */
  private _buildEligibleProductBuilder(
    sourceCategoryIds: number[],
    audienceGenders?: ProductGender[] | null,
  ): SelectQueryBuilder<ProductEntity> {
    const qb = this.productRepository
      .createQueryBuilder('product')
      .innerJoin(
        'product.category',
        'category',
        'category.status = :catStatus',
        {
          catStatus: CategoryStatus.active,
        },
      )
      .andWhere('product.status = :status', { status: ProductStatus.active })
      .andWhere('product.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('product.price > 0')
      .andWhere('product.categoryId != 1')
      .andWhere('product.categoryId IN (:...sourceCategoryIds)', {
        sourceCategoryIds,
      });
    if (audienceGenders?.length) {
      qb.andWhere('product.gender IN (:...audienceGenders)', {
        audienceGenders,
      });
    }
    return applyDiscoveryEligibilityFilters(qb, 'product');
  }

  /** Eligible id projection used by facet temp-table materialization. */
  private _buildEligibleProductIdBuilder(
    manager: {
      getRepository: (
        entity: typeof ProductEntity,
      ) => Repository<ProductEntity>;
    },
    sourceCategoryIds: number[],
    audienceGenders?: ProductGender[] | null,
  ): SelectQueryBuilder<ProductEntity> {
    const qb = manager
      .getRepository(ProductEntity)
      .createQueryBuilder('product')
      .select('product.id', 'id')
      .innerJoin(
        'product.category',
        'category',
        'category.status = :catStatus',
        { catStatus: CategoryStatus.active },
      )
      .andWhere('product.status = :status', { status: ProductStatus.active })
      .andWhere('product.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('product.price > 0')
      .andWhere('product.categoryId != 1')
      .andWhere('product.categoryId IN (:...sourceCategoryIds)', {
        sourceCategoryIds,
      });
    if (audienceGenders?.length) {
      qb.andWhere('product.gender IN (:...audienceGenders)', {
        audienceGenders,
      });
    }
    return applyDiscoveryEligibilityFilters(qb, 'product');
  }

  /**
   * Authoritative AttributeValue ownership check.
   * Foreign value ids are dropped (parser-consistent ignore policy); SQL EXISTS
   * still joins attribute_value.attributeId as defense in depth.
   */
  private async _sanitizeStorefrontPlpFilters(
    filters: StorefrontPlpFilters,
  ): Promise<StorefrontPlpFilters> {
    const valueIds = [
      ...new Set(filters.attributes.flatMap((g) => g.valueIds)),
    ];
    if (!valueIds.length) return filters;

    const rows: Array<{ id: number; attributeId: number }> =
      await this.productRepository.manager
        .createQueryBuilder()
        .select('av.id', 'id')
        .addSelect('av.attributeId', 'attributeId')
        .from('attribute_value', 'av')
        .where('av.id IN (:...valueIds)', { valueIds })
        .getRawMany();

    const ownership = new Map<number, number>();
    for (const row of rows) {
      ownership.set(Number(row.id), Number(row.attributeId));
    }

    return {
      ...filters,
      attributes: sanitizeStorefrontPlpAttributeOwnership(
        filters.attributes,
        ownership,
      ),
    };
  }

  private async _buildStorefrontFacets(
    sourceCategoryIds: number[],
    filters: StorefrontPlpFilters,
    tryToToman: number,
    audienceGenders?: ProductGender[] | null,
  ): Promise<StorefrontPlpFiltersPayload> {
    const hasSelectedAttrs = filters.attributes.some(
      (g) => g.valueIds.length > 0,
    );

    // Selected-attr requests: share one match materialization across
    // brand / price / attribute facets (avoids parallel EXISTS full scans).
    if (hasSelectedAttrs) {
      return this._buildStorefrontFacetsSelected(
        sourceCategoryIds,
        filters,
        tryToToman,
        audienceGenders,
      );
    }

    const [brands, price, attributes] = await Promise.all([
      this._computeBrandFacets(
        sourceCategoryIds,
        filters,
        tryToToman,
        audienceGenders,
      ),
      this._computePriceFacet(
        sourceCategoryIds,
        filters,
        tryToToman,
        audienceGenders,
      ),
      this._computeAttributeFacets(
        sourceCategoryIds,
        filters,
        tryToToman,
        audienceGenders,
      ),
    ]);

    return { brands, price, attributes };
  }

  /**
   * Brand + price + attribute facets for requests with selected attributes.
   * Brand/price share one attr-match materialization (no EXISTS); attribute
   * facets use the dedicated selected-path aggregator in parallel.
   */
  private async _buildStorefrontFacetsSelected(
    sourceCategoryIds: number[],
    filters: StorefrontPlpFilters,
    tryToToman: number,
    audienceGenders?: ProductGender[] | null,
  ): Promise<StorefrontPlpFiltersPayload> {
    const [brandPrice, attributes] = await Promise.all([
      this._computeBrandPriceFacetsWithAttrMatch(
        sourceCategoryIds,
        filters,
        tryToToman,
        audienceGenders,
      ),
      this._aggregateAttributeFacetsSelectedPath(
        sourceCategoryIds,
        filters,
        tryToToman,
        audienceGenders,
      ),
    ]);
    return {
      brands: brandPrice.brands,
      price: brandPrice.price,
      attributes,
    };
  }

  /**
   * Brand + price facets when attributes are selected: materialize the
   * AND-matched product id set once, then aggregate without EXISTS chains.
   */
  private async _computeBrandPriceFacetsWithAttrMatch(
    sourceCategoryIds: number[],
    filters: StorefrontPlpFilters,
    tryToToman: number,
    audienceGenders?: ProductGender[] | null,
  ): Promise<{
    brands: StorefrontPlpBrandFacet[];
    price: StorefrontPlpPriceFacet;
  }> {
    return this.productRepository.manager.transaction(async (manager) => {
      const selectedGroups = filters.attributes.filter(
        (g) => g.valueIds.length > 0,
      );
      const groupCount = selectedGroups.length;

      const eligibleQb = this._buildEligibleProductIdBuilder(
        manager,
        sourceCategoryIds,
        audienceGenders,
      );

      const [eligibleSql, eligibleParams] = eligibleQb.getQueryAndParameters();
      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_bp_base`);
      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_bp_match`);
      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_bp_all`);
      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_bp_brand`);
      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_bp_price`);

      await manager.query(
        `CREATE TEMPORARY TABLE plp_bp_base (id INT PRIMARY KEY) AS ${eligibleSql}`,
        eligibleParams,
      );

      await manager.query(`
        CREATE TEMPORARY TABLE plp_bp_match (
          productId INT NOT NULL,
          groupAttrId INT NOT NULL,
          PRIMARY KEY (productId, groupAttrId)
        )
      `);

      for (const group of selectedGroups) {
        const valuePh = group.valueIds.map(() => '?').join(',');
        await manager.query(
          `
            INSERT IGNORE INTO plp_bp_match (productId, groupAttrId)
            SELECT DISTINCT pav.productId, ?
            FROM product_attribute_value pav
            INNER JOIN plp_bp_base e ON e.id = pav.productId
            INNER JOIN attribute_value av
              ON av.id = pav.attributeValueId
             AND av.attributeId = ?
            WHERE pav.isDeleted = 0
              AND pav.attributeValueId IN (${valuePh})
          `,
          [group.attributeId, group.attributeId, ...group.valueIds],
        );
      }

      await manager.query(
        `
          CREATE TEMPORARY TABLE plp_bp_all (id INT PRIMARY KEY) AS
          SELECT productId AS id
          FROM plp_bp_match
          GROUP BY productId
          HAVING COUNT(*) = ?
        `,
        [groupCount],
      );

      {
        const brandUniverseQb = manager
          .getRepository(ProductEntity)
          .createQueryBuilder('product')
          .select('product.id', 'id')
          .innerJoin('plp_bp_all', 'sel', 'sel.id = product.id');
        applyStorefrontPlpFilters(brandUniverseQb, filters, tryToToman, {
          skipBrands: true,
          skipAttributeId: true,
        });
        const [brandSql, brandParams] = brandUniverseQb.getQueryAndParameters();
        await manager.query(
          `CREATE TEMPORARY TABLE plp_bp_brand (id INT PRIMARY KEY) AS ${brandSql}`,
          brandParams,
        );
      }

      {
        const priceUniverseQb = manager
          .getRepository(ProductEntity)
          .createQueryBuilder('product')
          .select('product.id', 'id')
          .innerJoin('plp_bp_all', 'sel', 'sel.id = product.id');
        applyStorefrontPlpFilters(priceUniverseQb, filters, tryToToman, {
          skipPrice: true,
          skipAttributeId: true,
        });
        const [priceSql, priceParams] = priceUniverseQb.getQueryAndParameters();
        await manager.query(
          `CREATE TEMPORARY TABLE plp_bp_price (id INT PRIMARY KEY) AS ${priceSql}`,
          priceParams,
        );
      }

      const brandRows: Array<{
        id: number | string;
        name: string | null;
        count: number | string;
      }> = await manager.query(`
        SELECT
          product.brandId AS id,
          COALESCE(NULLIF(brand.sourceName, ''), brand.name) AS name,
          COUNT(DISTINCT product.id) AS count
        FROM plp_bp_brand e
        INNER JOIN product product ON product.id = e.id
        INNER JOIN brand brand ON brand.id = product.brandId
        WHERE product.brandId IS NOT NULL
        GROUP BY product.brandId, brand.name, brand.sourceName
        ORDER BY count DESC, name ASC, id ASC
      `);

      const brandAll = brandRows
        .map((row) => ({
          id: Number(row.id),
          name: String(row.name || '').trim() || `Brand ${row.id}`,
          count: Number(row.count) || 0,
        }))
        .filter((row) => row.id > 0 && row.count > 0);
      const selectedBrands = new Set(filters.brandIds);
      const brands = brandAll.slice(0, STOREFRONT_PLP_MAX_BRAND_FACETS);
      const topBrandIds = new Set(brands.map((b) => b.id));
      for (const brand of brandAll) {
        if (selectedBrands.has(brand.id) && !topBrandIds.has(brand.id)) {
          brands.push(brand);
        }
      }

      const priceRow: Array<{
        minTry: number | string | null;
        maxTry: number | string | null;
      }> = await manager.query(`
        SELECT
          MIN(${STOREFRONT_EFFECTIVE_PRICE_SQL}) AS minTry,
          MAX(${STOREFRONT_EFFECTIVE_PRICE_SQL}) AS maxTry
        FROM plp_bp_price e
        INNER JOIN product product ON product.id = e.id
      `);
      const min = tryPriceToToman(
        priceRow?.[0]?.minTry != null ? Number(priceRow[0].minTry) : null,
        tryToToman,
      );
      const max = tryPriceToToman(
        priceRow?.[0]?.maxTry != null ? Number(priceRow[0].maxTry) : null,
        tryToToman,
      );
      const price =
        min == null || max == null || max < min
          ? { min: null, max: null }
          : { min, max };

      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_bp_price`);
      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_bp_brand`);
      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_bp_all`);
      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_bp_match`);
      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_bp_base`);

      return { brands, price };
    });
  }

  private async _computeBrandFacets(
    sourceCategoryIds: number[],
    filters: StorefrontPlpFilters,
    tryToToman: number,
    audienceGenders?: ProductGender[] | null,
  ): Promise<StorefrontPlpBrandFacet[]> {
    const qb = this._buildEligibleProductBuilder(
      sourceCategoryIds,
      audienceGenders,
    )
      .innerJoin('product.brand', 'brand')
      .select('product.brandId', 'id')
      .addSelect(`COALESCE(NULLIF(brand.sourceName, ''), brand.name)`, 'name')
      .addSelect('COUNT(DISTINCT product.id)', 'count')
      .andWhere('product.brandId IS NOT NULL')
      .groupBy('product.brandId')
      .addGroupBy('brand.name')
      .addGroupBy('brand.sourceName')
      .orderBy('count', 'DESC')
      .addOrderBy('name', 'ASC')
      .addOrderBy('id', 'ASC');

    // Self-facet exclusion: price + attributes, not brands.
    applyStorefrontPlpFilters(qb, filters, tryToToman, { skipBrands: true });

    const rows = await qb.getRawMany();
    const all = rows
      .map((row) => ({
        id: Number(row.id),
        name: String(row.name || '').trim() || `Brand ${row.id}`,
        count: Number(row.count) || 0,
      }))
      .filter((row) => row.id > 0 && row.count > 0);

    const selected = new Set(filters.brandIds);
    const top = all.slice(0, STOREFRONT_PLP_MAX_BRAND_FACETS);
    const topIds = new Set(top.map((b) => b.id));
    for (const brand of all) {
      if (selected.has(brand.id) && !topIds.has(brand.id)) {
        top.push(brand);
      }
    }
    return top;
  }

  private async _computePriceFacet(
    sourceCategoryIds: number[],
    filters: StorefrontPlpFilters,
    tryToToman: number,
    audienceGenders?: ProductGender[] | null,
  ): Promise<StorefrontPlpPriceFacet> {
    const qb = this._buildEligibleProductBuilder(
      sourceCategoryIds,
      audienceGenders,
    )
      .select(`MIN(${STOREFRONT_EFFECTIVE_PRICE_SQL})`, 'minTry')
      .addSelect(`MAX(${STOREFRONT_EFFECTIVE_PRICE_SQL})`, 'maxTry');

    applyStorefrontPlpFilters(qb, filters, tryToToman, { skipPrice: true });

    const row = await qb.getRawOne();
    const min = tryPriceToToman(
      row?.minTry != null ? Number(row.minTry) : null,
      tryToToman,
    );
    const max = tryPriceToToman(
      row?.maxTry != null ? Number(row.maxTry) : null,
      tryToToman,
    );

    if (min == null || max == null || max < min) {
      return { min: null, max: null };
    }
    return { min, max };
  }

  /**
   * Unfiltered hot path (Category-2 scale):
   * 1) materialize eligible product ids
   * 2) aggregate COUNT(DISTINCT product) per attributeValueId via covering PAV index
   *    (no Attribute join, no value-name work, no ROLLUP over discarded attrs)
   * 3) join labels in application; keep deterministic top-N attributes
   *
   * Top-N membership uses sum-of-value-product-counts as a ranking key (same
   * 20 attrs as COUNT(DISTINCT product) discovery on measured Category 2;
   * multi-valued attributes may reorder within the set). Value counts remain
   * exact COUNT(DISTINCT productId) per AttributeValue.
   */
  private async _aggregateAttributeFacetsSinglePass(
    sourceCategoryIds: number[],
    filters: StorefrontPlpFilters,
    tryToToman: number,
    audienceGenders?: ProductGender[] | null,
  ): Promise<StorefrontPlpAttributeFacet[]> {
    return this.productRepository.manager.transaction(async (manager) => {
      const eligibleQb = this._buildEligibleProductIdBuilder(
        manager,
        sourceCategoryIds,
        audienceGenders,
      );

      applyStorefrontPlpFilters(eligibleQb, filters, tryToToman, {
        skipAttributeId: true,
      });

      const [eligibleSql, eligibleParams] = eligibleQb.getQueryAndParameters();
      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_attr_eligible`);
      await manager.query(
        `CREATE TEMPORARY TABLE plp_attr_eligible (id INT PRIMARY KEY) AS ${eligibleSql}`,
        eligibleParams,
      );

      const rawCounts: Array<{
        valueId: number | string;
        productCount: number | string;
      }> = await manager.query(
        `
          SELECT
            pav.attributeValueId AS valueId,
            COUNT(DISTINCT e.id) AS productCount
          FROM plp_attr_eligible e
          INNER JOIN product_attribute_value pav
            ON pav.productId = e.id
           AND pav.isDeleted = 0
          GROUP BY pav.attributeValueId
          `,
      );

      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_attr_eligible`);

      const valueIds = rawCounts
        .map((row) => Number(row.valueId))
        .filter((id) => id > 0);
      if (!valueIds.length) return [];

      const valueMeta = new Map<
        number,
        { attributeId: number; name: string }
      >();
      const chunkSize = 1000;
      for (let i = 0; i < valueIds.length; i += chunkSize) {
        const chunk = valueIds.slice(i, i + chunkSize);
        const rows: Array<{
          id: number | string;
          attributeId: number | string;
          name: string | null;
        }> = await manager.query(
          `SELECT id, attributeId, name
           FROM attribute_value
           WHERE id IN (${chunk.map(() => '?').join(',')})`,
          chunk,
        );
        for (const row of rows) {
          valueMeta.set(Number(row.id), {
            attributeId: Number(row.attributeId),
            name: String(row.name || '').trim(),
          });
        }
      }

      const attrRows: Array<{
        id: number | string;
        name: string | null;
        type: string | null;
      }> = await manager.query(
        `SELECT id, name, type
         FROM attribute
         WHERE name NOT IN (${[...STOREFRONT_PLP_EXCLUDED_ATTRIBUTE_NAMES]
           .map(() => '?')
           .join(',')})`,
        [...STOREFRONT_PLP_EXCLUDED_ATTRIBUTE_NAMES],
      );
      const attrMeta = new Map<
        number,
        { id: number; name: string; type: string }
      >();
      for (const row of attrRows) {
        const id = Number(row.id);
        const name = String(row.name || '').trim();
        if (!id || !name || isExcludedFilterAttributeName(name)) continue;
        attrMeta.set(id, {
          id,
          name,
          type: String(row.type || 'other'),
        });
      }

      const sumByAttr = new Map<number, number>();
      const valuesByAttr = new Map<
        number,
        { id: number; name: string; count: number }[]
      >();

      for (const row of rawCounts) {
        const valueId = Number(row.valueId);
        const productCount = Number(row.productCount) || 0;
        if (!valueId || productCount <= 0) continue;
        const meta = valueMeta.get(valueId);
        if (!meta) continue;
        const valueName = meta.name;
        // Match SQL CHAR_LENGTH(av.name) <= MAX filter used elsewhere.
        if (
          !valueName ||
          valueName.length > STOREFRONT_PLP_MAX_VALUE_NAME_LENGTH
        ) {
          continue;
        }
        const attr = attrMeta.get(meta.attributeId);
        if (!attr) continue;

        sumByAttr.set(attr.id, (sumByAttr.get(attr.id) || 0) + productCount);
        const list = valuesByAttr.get(attr.id) || [];
        list.push({ id: valueId, name: valueName, count: productCount });
        valuesByAttr.set(attr.id, list);
      }

      const topAttrIds = [...sumByAttr.entries()]
        .sort((a, b) => {
          if (b[1] !== a[1]) return b[1] - a[1];
          return a[0] - b[0];
        })
        .slice(0, STOREFRONT_PLP_MAX_FACET_ATTRIBUTES)
        .map(([id]) => id);

      const facets: StorefrontPlpAttributeFacet[] = [];
      for (const attrId of topAttrIds) {
        const meta = attrMeta.get(attrId);
        const values = valuesByAttr.get(attrId) || [];
        if (!meta || !values.length) continue;
        values.sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          const byName = a.name.localeCompare(b.name, 'fa');
          if (byName !== 0) return byName;
          return a.id - b.id;
        });
        facets.push({
          id: meta.id,
          name: meta.name,
          type: meta.type,
          values,
        });
      }
      return facets;
    });
  }

  private async _computeAttributeFacets(
    sourceCategoryIds: number[],
    filters: StorefrontPlpFilters,
    tryToToman: number,
    audienceGenders?: ProductGender[] | null,
  ): Promise<StorefrontPlpAttributeFacet[]> {
    const selectedAttrIds = filters.attributes
      .filter((g) => g.valueIds.length > 0)
      .map((g) => g.attributeId);

    // Large-scope hot path: one Product/PAV aggregation instead of discovery+values.
    if (!selectedAttrIds.length) {
      return this._aggregateAttributeFacetsSinglePass(
        sourceCategoryIds,
        filters,
        tryToToman,
        audienceGenders,
      );
    }

    // Selected-attribute path: shared match relation + narrowed aggregations
    // (avoids N+1 full-scope EXISTS discovery/value passes).
    return this._aggregateAttributeFacetsSelectedPath(
      sourceCategoryIds,
      filters,
      tryToToman,
      audienceGenders,
    );
  }

  /**
   * Selected-attribute facet path.
   *
   * Builds once:
   *   - eligible products (brand+price+scope)
   *   - per-product selected-group match bits (DISTINCT productId, groupAttrId)
   * Then derives:
   *   - all-selected set (AND across groups)
   *   - all-except-A sets (self-exclusion)
   * and aggregates value counts only over those narrow id sets.
   *
   * Preserves I2 (OR within / AND across / self-exclusion) and I3 ownership
   * (match insert joins attribute_value.attributeId).
   * Duplicate PAVs cannot inflate: PRIMARY KEY + COUNT(DISTINCT productId).
   */
  private async _aggregateAttributeFacetsSelectedPath(
    sourceCategoryIds: number[],
    filters: StorefrontPlpFilters,
    tryToToman: number,
    audienceGenders?: ProductGender[] | null,
  ): Promise<StorefrontPlpAttributeFacet[]> {
    const selectedGroups = filters.attributes.filter(
      (g) => g.valueIds.length > 0,
    );
    if (!selectedGroups.length) {
      return this._aggregateAttributeFacetsSinglePass(
        sourceCategoryIds,
        filters,
        tryToToman,
        audienceGenders,
      );
    }

    return this.productRepository.manager.transaction(async (manager) => {
      const selectedAttrIds = selectedGroups.map((g) => g.attributeId);
      const selectedSet = new Set(selectedAttrIds);
      const groupCount = selectedGroups.length;

      const eligibleQb = this._buildEligibleProductIdBuilder(
        manager,
        sourceCategoryIds,
        audienceGenders,
      );

      applyStorefrontPlpFilters(eligibleQb, filters, tryToToman, {
        skipAttributeId: true,
      });

      const [eligibleSql, eligibleParams] = eligibleQb.getQueryAndParameters();
      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_sel_base`);
      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_sel_match`);
      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_sel_all`);

      await manager.query(
        `CREATE TEMPORARY TABLE plp_sel_base (id INT PRIMARY KEY) AS ${eligibleSql}`,
        eligibleParams,
      );

      await manager.query(`
        CREATE TEMPORARY TABLE plp_sel_match (
          productId INT NOT NULL,
          groupAttrId INT NOT NULL,
          PRIMARY KEY (productId, groupAttrId),
          KEY idx_plp_sel_match_group (groupAttrId, productId)
        )
      `);

      for (const group of selectedGroups) {
        const valuePh = group.valueIds.map(() => '?').join(',');
        // Drive from attributeValueId (selective) into eligible set — avoids
        // scanning every eligible product's full PAV row set.
        await manager.query(
          `
            INSERT IGNORE INTO plp_sel_match (productId, groupAttrId)
            SELECT DISTINCT pav.productId, ?
            FROM product_attribute_value pav
            INNER JOIN plp_sel_base e ON e.id = pav.productId
            INNER JOIN attribute_value av
              ON av.id = pav.attributeValueId
             AND av.attributeId = ?
            WHERE pav.isDeleted = 0
              AND pav.attributeValueId IN (${valuePh})
          `,
          [group.attributeId, group.attributeId, ...group.valueIds],
        );
      }

      await manager.query(
        `
          CREATE TEMPORARY TABLE plp_sel_all (id INT PRIMARY KEY) AS
          SELECT productId AS id
          FROM plp_sel_match
          GROUP BY productId
          HAVING COUNT(*) = ?
        `,
        [groupCount],
      );

      // Value counts under full AND (non-selected facets + discovery ranking).
      // Covering PAV path — same technique as the unfiltered hot path.
      const allSelectedCounts: Array<{
        valueId: number | string;
        productCount: number | string;
      }> = await manager.query(`
        SELECT
          pav.attributeValueId AS valueId,
          COUNT(DISTINCT e.id) AS productCount
        FROM plp_sel_all e
        INNER JOIN product_attribute_value pav
          ON pav.productId = e.id
         AND pav.isDeleted = 0
        GROUP BY pav.attributeValueId
      `);

      // Self-excluding counts: one covering aggregation over the except-A
      // product set (for N=1 that is the full brand/price eligible base).
      // Do NOT drive from attribute_value.attributeId — popular attributes
      // have catalog-wide PAV cardinality and that plan is pathological.
      const selfExclCounts = new Map<
        number,
        Array<{ valueId: number; productCount: number }>
      >();

      for (const attrId of selectedAttrIds) {
        await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_sel_except`);
        const exceptTable =
          groupCount === 1 ? 'plp_sel_base' : 'plp_sel_except';

        if (groupCount > 1) {
          await manager.query(
            `
              CREATE TEMPORARY TABLE plp_sel_except (id INT PRIMARY KEY) AS
              SELECT productId AS id
              FROM plp_sel_match
              WHERE groupAttrId != ?
              GROUP BY productId
              HAVING COUNT(*) = ?
            `,
            [attrId, groupCount - 1],
          );
        }

        const rows: Array<{
          valueId: number | string;
          productCount: number | string;
        }> = await manager.query(`
          SELECT
            pav.attributeValueId AS valueId,
            COUNT(DISTINCT e.id) AS productCount
          FROM ${exceptTable} e
          INNER JOIN product_attribute_value pav
            ON pav.productId = e.id
           AND pav.isDeleted = 0
          GROUP BY pav.attributeValueId
        `);

        // Keep only values owned by attrId (resolved after label join below).
        selfExclCounts.set(
          attrId,
          rows.map((row) => ({
            valueId: Number(row.valueId),
            productCount: Number(row.productCount) || 0,
          })),
        );
        if (groupCount > 1) {
          await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_sel_except`);
        }
      }

      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_sel_all`);
      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_sel_match`);
      await manager.query(`DROP TEMPORARY TABLE IF EXISTS plp_sel_base`);

      const allValueIds = new Set<number>();
      for (const row of allSelectedCounts) {
        const id = Number(row.valueId);
        if (id > 0) allValueIds.add(id);
      }
      for (const rows of selfExclCounts.values()) {
        for (const row of rows) {
          if (row.valueId > 0) allValueIds.add(row.valueId);
        }
      }
      // Ensure selected filter values are resolvable even if count is 0.
      for (const group of selectedGroups) {
        for (const valueId of group.valueIds) allValueIds.add(valueId);
      }

      const valueIds = [...allValueIds];
      if (!valueIds.length && !selectedAttrIds.length) return [];

      const valueMeta = new Map<
        number,
        { attributeId: number; name: string }
      >();
      const chunkSize = 1000;
      for (let i = 0; i < valueIds.length; i += chunkSize) {
        const chunk = valueIds.slice(i, i + chunkSize);
        if (!chunk.length) continue;
        const rows: Array<{
          id: number | string;
          attributeId: number | string;
          name: string | null;
        }> = await manager.query(
          `SELECT id, attributeId, name
           FROM attribute_value
           WHERE id IN (${chunk.map(() => '?').join(',')})`,
          chunk,
        );
        for (const row of rows) {
          valueMeta.set(Number(row.id), {
            attributeId: Number(row.attributeId),
            name: String(row.name || '').trim(),
          });
        }
      }

      const attrRows: Array<{
        id: number | string;
        name: string | null;
        type: string | null;
      }> = await manager.query(
        `SELECT id, name, type
         FROM attribute
         WHERE name NOT IN (${[...STOREFRONT_PLP_EXCLUDED_ATTRIBUTE_NAMES]
           .map(() => '?')
           .join(',')})`,
        [...STOREFRONT_PLP_EXCLUDED_ATTRIBUTE_NAMES],
      );
      const attrMeta = new Map<
        number,
        { id: number; name: string; type: string }
      >();
      for (const row of attrRows) {
        const id = Number(row.id);
        const name = String(row.name || '').trim();
        if (!id || !name || isExcludedFilterAttributeName(name)) continue;
        attrMeta.set(id, {
          id,
          name,
          type: String(row.type || 'other'),
        });
      }

      // Force-include selected attributes even if discovery would omit them.
      for (const attrId of selectedAttrIds) {
        if (attrMeta.has(attrId)) continue;
        const meta = await manager.query(
          `SELECT id, name, type FROM attribute WHERE id = ? LIMIT 1`,
          [attrId],
        );
        const row = meta?.[0];
        if (!row?.id || isExcludedFilterAttributeName(row.name)) continue;
        attrMeta.set(Number(row.id), {
          id: Number(row.id),
          name: String(row.name || '').trim(),
          type: String(row.type || 'other'),
        });
      }

      const sumByAttr = new Map<number, number>();
      const valuesByAttr = new Map<
        number,
        { id: number; name: string; count: number }[]
      >();

      for (const row of allSelectedCounts) {
        const valueId = Number(row.valueId);
        const productCount = Number(row.productCount) || 0;
        if (!valueId || productCount <= 0) continue;
        const meta = valueMeta.get(valueId);
        if (!meta) continue;
        const valueName = meta.name;
        if (
          !valueName ||
          valueName.length > STOREFRONT_PLP_MAX_VALUE_NAME_LENGTH
        ) {
          continue;
        }
        const attr = attrMeta.get(meta.attributeId);
        if (!attr) continue;
        // Selected attrs get self-excluding counts below — skip here.
        if (selectedSet.has(attr.id)) continue;

        sumByAttr.set(attr.id, (sumByAttr.get(attr.id) || 0) + productCount);
        const list = valuesByAttr.get(attr.id) || [];
        list.push({ id: valueId, name: valueName, count: productCount });
        valuesByAttr.set(attr.id, list);
      }

      for (const [attrId, rows] of selfExclCounts) {
        const list: { id: number; name: string; count: number }[] = [];
        let sum = 0;
        for (const row of rows) {
          if (!row.valueId || row.productCount <= 0) continue;
          const meta = valueMeta.get(row.valueId);
          if (!meta || meta.attributeId !== attrId) continue;
          const valueName = meta.name;
          if (
            !valueName ||
            valueName.length > STOREFRONT_PLP_MAX_VALUE_NAME_LENGTH
          ) {
            continue;
          }
          if (!attrMeta.has(attrId)) continue;
          list.push({
            id: row.valueId,
            name: valueName,
            count: row.productCount,
          });
          sum += row.productCount;
        }
        valuesByAttr.set(attrId, list);
        sumByAttr.set(attrId, sum);
      }

      const discoveredIds = [...sumByAttr.entries()]
        .sort((a, b) => {
          if (b[1] !== a[1]) return b[1] - a[1];
          return a[0] - b[0];
        })
        .slice(0, STOREFRONT_PLP_MAX_FACET_ATTRIBUTES)
        .map(([id]) => id);

      const facetAttrIds: number[] = [];
      const seenFacet = new Set<number>();
      for (const id of discoveredIds) {
        if (seenFacet.has(id)) continue;
        seenFacet.add(id);
        facetAttrIds.push(id);
      }
      for (const id of selectedAttrIds) {
        if (seenFacet.has(id) || !attrMeta.has(id)) continue;
        seenFacet.add(id);
        facetAttrIds.push(id);
      }

      const facets: StorefrontPlpAttributeFacet[] = [];
      for (const attrId of facetAttrIds) {
        const meta = attrMeta.get(attrId);
        const values = valuesByAttr.get(attrId) || [];
        if (!meta || !values.length) continue;
        values.sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          const byName = a.name.localeCompare(b.name, 'fa');
          if (byName !== 0) return byName;
          return a.id - b.id;
        });
        facets.push({
          id: meta.id,
          name: meta.name,
          type: meta.type,
          values,
        });
      }
      return facets;
    });
  }

  /**
   * Admin-ready mapping write with identity + source consistency checks.
   * Identity is UNIQUE(sourceCategoryId); source is copied from category.
   */
  async upsertSourceCategoryMapping(input: {
    sourceCategoryId: number;
    canonicalCategoryId: number;
    source?: string | null;
    status?: SourceCategoryMappingStatus;
    note?: string | null;
  }): Promise<SourceCategoryMappingEntity> {
    const existing = await this.mappingRepository.findOne({
      where: { sourceCategoryId: input.sourceCategoryId },
    });

    const validated = await validateSourceCategoryMappingWrite(
      this.canonicalRepository.manager.getRepository(CategoryEntity),
      {
        findOne: async ({ where }) => {
          const row = await this.mappingRepository.findOne({
            where: { sourceCategoryId: where.sourceCategoryId },
            select: ['id', 'canonicalCategoryId'],
          });
          return row || undefined;
        },
      },
      {
        ...input,
        // Allow updating the same mapping row's canonical target.
        mappingId: existing?.id ?? null,
      },
      this.canonicalRepository,
    );

    if (existing) {
      existing.canonicalCategoryId = validated.canonicalCategoryId;
      existing.source = validated.source;
      existing.status = input.status ?? existing.status;
      existing.note = input.note !== undefined ? input.note : existing.note;
      return this.mappingRepository.save(existing);
    }

    const entity = this.mappingRepository.create({
      source: validated.source,
      sourceCategoryId: validated.sourceCategoryId,
      canonicalCategoryId: validated.canonicalCategoryId,
      status: input.status ?? SourceCategoryMappingStatus.active,
      note: input.note ?? null,
      createdAt: dateTime() as any,
    });

    return this.mappingRepository.save(entity);
  }

  async createCanonicalCategory(input: {
    name: string;
    parentId?: number | null;
    displayOrder?: number;
    imagePath?: string | null;
    discoveryImagePath?: string | null;
    audience?: string | null;
    status?: CanonicalCategoryStatus;
    isLocalPrototype?: boolean;
  }): Promise<CanonicalCategoryEntity> {
    const parentId = input.parentId ?? null;
    try {
      await this.assertValidParent(null, parentId);
    } catch (err) {
      if (err instanceof CanonicalHierarchyValidationError) {
        throw err;
      }
      throw err;
    }

    const entity = this.canonicalRepository.create({
      name: input.name,
      parentId,
      displayOrder: input.displayOrder ?? 1,
      imagePath: input.imagePath ?? null,
      discoveryImagePath: input.discoveryImagePath ?? null,
      audience: input.audience ?? null,
      status: input.status ?? CanonicalCategoryStatus.active,
      isLocalPrototype: input.isLocalPrototype ?? false,
      createdAt: dateTime() as any,
    });

    return this.canonicalRepository.save(entity);
  }

  /**
   * CAT-2 Admin — update canonical category presentation / hierarchy fields.
   * Additive; does not delete or remapping products.
   */
  async updateCanonicalCategory(
    id: number,
    input: {
      name?: string;
      parentId?: number | null;
      displayOrder?: number;
      imagePath?: string | null;
      discoveryImagePath?: string | null;
      audience?: string | null;
      status?: CanonicalCategoryStatus;
    },
  ): Promise<CanonicalCategoryEntity> {
    const entity = await this.canonicalRepository.findOne({ where: { id } });
    if (!entity) {
      throw new Error(`Canonical category ${id} not found`);
    }

    if (input.parentId !== undefined) {
      await this.assertValidParent(id, input.parentId);
      entity.parentId = input.parentId;
    }
    if (input.name !== undefined) entity.name = input.name;
    if (input.displayOrder !== undefined) {
      entity.displayOrder = input.displayOrder;
    }
    if (input.imagePath !== undefined) entity.imagePath = input.imagePath;
    if (input.discoveryImagePath !== undefined) {
      entity.discoveryImagePath = input.discoveryImagePath;
    }
    if (input.audience !== undefined) entity.audience = input.audience;
    if (input.status !== undefined) entity.status = input.status;

    return this.canonicalRepository.save(entity);
  }

  async listCanonicalCategoriesAdmin(): Promise<CanonicalCategoryEntity[]> {
    return this.canonicalRepository.find({
      order: { displayOrder: 'ASC', id: 'ASC' },
    });
  }
}

export { SourceCategoryMappingValidationError };
