import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { BrandEntity } from '../brand/entities/brand.entity';
import {
  CanonicalCategoryEntity,
  CanonicalCategoryStatus,
} from '../catalog/entities/canonical-category.entity';
import { resolveCanonicalCategoryScope } from '../catalog/canonical-category-scope.resolver';
import {
  applyCanonicalProductEligibility,
  CanonicalEligibilityData,
  CanonicalProductEligibility,
} from '../catalog/canonical-product-eligibility';
import {
  loadCanonicalEligibilityData,
  resolveCanonicalProductEligibilityFromData,
} from '../catalog/canonical-product-eligibility.loader';
import {
  applyStorefrontPlpFilters,
  emptyStorefrontPlpFiltersPayload,
  toAppliedStorefrontPlpFilters,
} from '../catalog/storefront-plp.filters';
import {
  applyStorefrontDiscountDiscoveryFilter,
  applyStorefrontPlpSort,
  STOREFRONT_EFFECTIVE_PRICE_SQL,
  STOREFRONT_VISIBLE_DISCOUNT_SQL,
} from '../catalog/storefront-plp.query';
import {
  buildStorefrontPlpPagination,
  mapStorefrontPlpProduct,
  StorefrontPlpProductItem,
} from '../catalog/storefront-plp.mapper';
import { CategoryStatus } from '../category/entities/category.entity';
import { applyDiscoveryEligibilityFilters } from '../product/discovery-eligibility';
import {
  ProductEntity,
  ProductStatus,
} from '../product/entities/product.entity';
import { SettingService } from '../setting/setting.service';
import { BrandAliasEntity } from './entities/brand-alias.entity';
import {
  escapeLikePattern,
  lightTypoMatch,
  normalizeSearchText,
} from './search-normalize';
import { buildSearchRelevanceSql, persianNormalizeSql } from './search-ranking';
import {
  isCommercialSearchSort,
  StorefrontSearchQuery,
} from './storefront-search.query';
import type { StorefrontSuggestionQuery } from './storefront-suggestion.query';
import {
  SUGGESTION_MAX_RESULTS,
  SUGGESTION_MIN_PRODUCT_QUERY_LENGTH,
  SUGGESTION_RANKING_WEIGHTS,
} from './suggestion-ranking';

export type StorefrontSearchResponse = {
  query: string;
  items: StorefrontPlpProductItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  sort: string;
  filters: ReturnType<typeof emptyStorefrontPlpFiltersPayload>;
  appliedFilters: ReturnType<typeof toAppliedStorefrontPlpFilters>;
  matchedCategoryIds: number[];
};

export type StorefrontSuggestionItem = {
  type: 'brand' | 'category' | 'product';
  id: number;
  label: string;
  /** For brand: preferred search text; optional otherwise. */
  query?: string;
  /** Category hub vs leaf — storefront builds destination. */
  hasChildren?: boolean;
  score: number;
};

export type StorefrontSuggestionsResponse = {
  query: string;
  items: StorefrontSuggestionItem[];
};

type BrandAliasRow = {
  brandId: number;
  normalizedAlias: string;
};

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    @InjectRepository(BrandAliasEntity)
    private readonly brandAliasRepository: Repository<BrandAliasEntity>,
    @InjectRepository(BrandEntity)
    private readonly brandRepository: Repository<BrandEntity>,
    @InjectRepository(CanonicalCategoryEntity)
    private readonly canonicalRepository: Repository<CanonicalCategoryEntity>,
    private readonly settingService: SettingService,
  ) {}

  /**
   * Catalog Search V1 — A4 discovery + DB pagination + relevance in SQL.
   * Never queries external retailers.
   */
  async searchCatalog(
    query: StorefrontSearchQuery,
  ): Promise<StorefrontSearchResponse> {
    const started = Date.now();
    const tryToToman = await this.settingService.getTryToToman();
    const scopeData = await loadCanonicalEligibilityData(
      this.canonicalRepository.manager,
    );

    const [exactBrandIds, typoBrandIds] = await Promise.all([
      this.resolveExactBrandIds(query.tokens, query.normalizedQ),
      this.resolveTypoBrandIds(query.tokens),
    ]);
    const categoryMatch = this.resolveCategoryMatch(
      query.normalizedQ,
      query.tokens,
      scopeData,
    );

    // CAT-MAP-V2-B: category scope = the same eligibility PLP uses
    // (mapping slices + CAT-3B). Global search stays unscoped.
    let eligibility: CanonicalProductEligibility | null = null;
    if (query.categoryId != null) {
      eligibility = resolveCanonicalProductEligibilityFromData(
        query.categoryId,
        scopeData,
      );
      if (!eligibility.sourceCategoryIds.length) {
        return this.emptyResponse(query);
      }
    }

    const listingBuilder = this.buildEligibleSearchBuilder(eligibility)
      .leftJoinAndSelect('product.cover', 'cover')
      .leftJoinAndSelect('product.brand', 'brand')
      .addSelect(STOREFRONT_EFFECTIVE_PRICE_SQL, 'mainPrice')
      .addSelect(STOREFRONT_VISIBLE_DISCOUNT_SQL, 'visibleDiscount');

    this.applySearchCandidateFilter(listingBuilder, {
      tokens: query.tokens,
      normalizedQuery: query.normalizedQ,
      exactBrandIds,
      typoBrandIds,
      categorySourceIds: categoryMatch.sourceCategoryIds,
    });

    applyStorefrontPlpFilters(listingBuilder, query.filters, tryToToman);

    const relevance = buildSearchRelevanceSql({
      exactBrandIds,
      typoBrandIds: typoBrandIds.filter((id) => !exactBrandIds.includes(id)),
      categorySourceIds: categoryMatch.sourceCategoryIds,
      tokens: query.tokens,
      normalizedQuery: query.normalizedQ,
    });
    listingBuilder.addSelect(relevance.sql, 'searchRelevance');
    for (const [key, value] of Object.entries(relevance.params)) {
      listingBuilder.setParameter(key, value);
    }

    if (isCommercialSearchSort(query.sort)) {
      if (query.sort === 'discount') {
        applyStorefrontDiscountDiscoveryFilter(listingBuilder);
      }
      applyStorefrontPlpSort(listingBuilder, query.sort);
    } else {
      listingBuilder.orderBy('searchRelevance', 'DESC');
      listingBuilder.addOrderBy('product.id', 'DESC');
    }

    const [rows, total] = await listingBuilder
      .take(query.limit)
      .skip((query.page - 1) * query.limit)
      .getManyAndCount();

    const elapsedMs = Date.now() - started;
    this.logger.log(
      `catalog_search q_len=${query.q.length} tokens=${query.tokens.length} total=${total} page=${query.page} ms=${elapsedMs}`,
    );

    return {
      query: query.q,
      items: rows.map((row) => mapStorefrontPlpProduct(row, tryToToman)),
      pagination: buildStorefrontPlpPagination(query.page, query.limit, total),
      sort: query.sort,
      filters: emptyStorefrontPlpFiltersPayload(),
      appliedFilters: toAppliedStorefrontPlpFilters(query.filters),
      matchedCategoryIds: categoryMatch.canonicalIds,
    };
  }

  /**
   * Lightweight autocomplete suggestions — prefix-friendly, bounded.
   * Prefer brand/category; product titles only for longer queries.
   * Never live-queries retailers / crawler.
   */
  async getSuggestions(
    query: StorefrontSuggestionQuery,
  ): Promise<StorefrontSuggestionsResponse> {
    const started = Date.now();
    const needle = query.normalizedQ;
    const prefix = `${escapeLikePattern(needle)}%`;
    const limit = Math.min(query.limit, SUGGESTION_MAX_RESULTS);

    const [brandHits, categoryHits, productHits] = await Promise.all([
      this.suggestBrands(needle, prefix, limit),
      this.suggestCategories(needle, prefix, limit),
      needle.length >= SUGGESTION_MIN_PRODUCT_QUERY_LENGTH
        ? this.suggestProducts(needle, prefix, Math.min(3, limit))
        : Promise.resolve([] as StorefrontSuggestionItem[]),
    ]);

    const brandSorted = [...brandHits].sort(
      (a, b) => b.score - a.score || a.id - b.id,
    );
    const categorySorted = [...categoryHits].sort(
      (a, b) => b.score - a.score || a.id - b.id,
    );
    const productSorted = [...productHits].sort(
      (a, b) => b.score - a.score || a.id - b.id,
    );

    // 1-char queries: keep a small brand-first mix; never flood with products.
    const pooled =
      needle.length === 1
        ? [...brandSorted.slice(0, 5), ...categorySorted.slice(0, 3)]
        : [...brandSorted, ...categorySorted, ...productSorted];

    const merged = pooled.sort(
      (a, b) =>
        b.score - a.score ||
        a.type.localeCompare(b.type) ||
        a.id - b.id ||
        a.label.localeCompare(b.label, 'fa'),
    );

    const seen = new Set<string>();
    const items: StorefrontSuggestionItem[] = [];
    for (const item of merged) {
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      if (items.length >= limit) break;
    }

    this.logger.log(
      `catalog_suggestions q_len=${query.q.length} items=${items.length} ms=${
        Date.now() - started
      }`,
    );

    return { query: query.q, items };
  }

  private async suggestBrands(
    needle: string,
    prefix: string,
    limit: number,
  ): Promise<StorefrontSuggestionItem[]> {
    const w = SUGGESTION_RANKING_WEIGHTS;
    const aliasRows: Array<{
      brandId: number;
      alias: string;
      normalizedAlias: string;
      brandName: string | null;
      sourceName: string | null;
    }> = await this.brandAliasRepository
      .createQueryBuilder('alias')
      .innerJoin(BrandEntity, 'brand', 'brand.id = alias.brandId')
      .select('alias.brandId', 'brandId')
      .addSelect('alias.alias', 'alias')
      .addSelect('alias.normalizedAlias', 'normalizedAlias')
      .addSelect('brand.name', 'brandName')
      .addSelect('brand.sourceName', 'sourceName')
      .where(
        'alias.normalizedAlias = :needle OR alias.normalizedAlias LIKE :prefix ESCAPE :esc',
        { needle, prefix, esc: '\\' },
      )
      .orderBy('alias.normalizedAlias', 'ASC')
      .take(limit * 3)
      .getRawMany();

    const brandNameRows: Array<{
      id: number;
      name: string | null;
      sourceName: string | null;
    }> = await this.brandRepository
      .createQueryBuilder('brand')
      .select('brand.id', 'id')
      .addSelect('brand.name', 'name')
      .addSelect('brand.sourceName', 'sourceName')
      .where(
        `${persianNormalizeSql(
          'brand.name',
        )} LIKE :prefix ESCAPE :esc OR ${persianNormalizeSql(
          'brand.sourceName',
        )} LIKE :prefix ESCAPE :esc OR ${persianNormalizeSql(
          'brand.name',
        )} = :needle OR ${persianNormalizeSql('brand.sourceName')} = :needle`,
        { prefix, needle, esc: '\\' },
      )
      .orderBy('brand.id', 'ASC')
      .take(limit * 2)
      .getRawMany();

    const byId = new Map<number, StorefrontSuggestionItem>();

    for (const row of aliasRows) {
      const id = Number(row.brandId);
      if (!id) continue;
      const normalizedAlias = String(row.normalizedAlias || '');
      const score =
        normalizedAlias === needle ? w.exactBrandAlias : w.brandAliasPrefix;
      const label =
        (row.brandName && String(row.brandName).trim()) ||
        (row.sourceName && String(row.sourceName).trim()) ||
        String(row.alias || normalizedAlias);
      const prev = byId.get(id);
      if (!prev || score > prev.score) {
        byId.set(id, {
          type: 'brand',
          id,
          label,
          query: label,
          score,
        });
      }
    }

    for (const row of brandNameRows) {
      const id = Number(row.id);
      if (!id) continue;
      const nameNorm = normalizeSearchText(row.name || '');
      const sourceNorm = normalizeSearchText(row.sourceName || '');
      const exact = nameNorm === needle || sourceNorm === needle;
      const score = exact ? w.exactBrandAlias : w.brandNamePrefix;
      const label =
        (row.name && String(row.name).trim()) ||
        (row.sourceName && String(row.sourceName).trim()) ||
        String(id);
      const prev = byId.get(id);
      if (!prev || score > prev.score) {
        byId.set(id, {
          type: 'brand',
          id,
          label,
          query: label,
          score,
        });
      }
    }

    return [...byId.values()];
  }

  private async suggestCategories(
    needle: string,
    prefix: string,
    limit: number,
  ): Promise<StorefrontSuggestionItem[]> {
    const w = SUGGESTION_RANKING_WEIGHTS;
    const rows = await this.canonicalRepository.find({
      where: { status: CanonicalCategoryStatus.active },
      select: ['id', 'name', 'parentId'],
      order: { displayOrder: 'ASC', id: 'ASC' },
    });

    const childCounts = new Map<number, number>();
    for (const row of rows) {
      if (row.parentId == null) continue;
      childCounts.set(row.parentId, (childCounts.get(row.parentId) || 0) + 1);
    }

    const hits: StorefrontSuggestionItem[] = [];
    for (const row of rows) {
      const name = normalizeSearchText(row.name);
      if (!name) continue;
      let score = 0;
      if (name === needle) score = w.categoryExact;
      else if (name.startsWith(needle)) score = w.categoryPrefix;
      else if (needle.length >= 2 && name.includes(needle))
        score = w.categoryContains;
      else continue;

      hits.push({
        type: 'category',
        id: row.id,
        label: row.name,
        hasChildren: (childCounts.get(row.id) || 0) > 0,
        score,
      });
    }

    hits.sort((a, b) => b.score - a.score || a.id - b.id);
    return hits.slice(0, limit);
  }

  private async suggestProducts(
    needle: string,
    prefix: string,
    limit: number,
  ): Promise<StorefrontSuggestionItem[]> {
    const w = SUGGESTION_RANKING_WEIGHTS;
    const nameNorm = persianNormalizeSql('product.name');
    const qb = this.productRepository
      .createQueryBuilder('product')
      .select(['product.id', 'product.name'])
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
      .andWhere(`${nameNorm} LIKE :prefix ESCAPE :esc`, {
        prefix,
        esc: '\\',
      });
    applyDiscoveryEligibilityFilters(qb, 'product');
    qb.orderBy('product.id', 'DESC').take(limit);

    const rows = await qb.getMany();
    return rows.map((row) => ({
      type: 'product' as const,
      id: row.id,
      label: row.name,
      score: w.productTitlePrefix,
    }));
  }

  private emptyResponse(
    query: StorefrontSearchQuery,
  ): StorefrontSearchResponse {
    return {
      query: query.q,
      items: [],
      pagination: buildStorefrontPlpPagination(query.page, query.limit, 0),
      sort: query.sort,
      filters: emptyStorefrontPlpFiltersPayload(),
      appliedFilters: toAppliedStorefrontPlpFilters(query.filters),
      matchedCategoryIds: [],
    };
  }

  /** Global (or category-scoped) A4-eligible product base — same gates as PLP. */
  private buildEligibleSearchBuilder(
    eligibility: CanonicalProductEligibility | null,
  ): SelectQueryBuilder<ProductEntity> {
    const qb = this.productRepository
      .createQueryBuilder('product')
      .innerJoin(
        'product.category',
        'category',
        'category.status = :catStatus',
        { catStatus: CategoryStatus.active },
      )
      .andWhere('product.status = :status', { status: ProductStatus.active })
      .andWhere('product.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('product.price > 0')
      .andWhere('product.categoryId != 1');

    if (eligibility) {
      applyCanonicalProductEligibility(
        qb,
        'product',
        eligibility,
        'searchElig',
      );
    }

    return applyDiscoveryEligibilityFilters(qb, 'product');
  }

  private applySearchCandidateFilter(
    qb: SelectQueryBuilder<ProductEntity>,
    input: {
      tokens: string[];
      normalizedQuery: string;
      exactBrandIds: number[];
      typoBrandIds: number[];
      categorySourceIds: number[];
    },
  ): void {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    const nameNorm = persianNormalizeSql('product.name');
    const brandNameNorm = persianNormalizeSql('brand.name');
    const brandSourceNorm = persianNormalizeSql('brand.sourceName');
    const categoryNameNorm = persianNormalizeSql('category.name');

    const brandIds = uniqueNums([
      ...input.exactBrandIds,
      ...input.typoBrandIds,
    ]);
    if (brandIds.length) {
      clauses.push('product.brandId IN (:...searchBrandIds)');
      params.searchBrandIds = brandIds;
    }
    if (input.categorySourceIds.length) {
      clauses.push('product.categoryId IN (:...searchCatSourceIds)');
      params.searchCatSourceIds = input.categorySourceIds;
    }

    const phrase = escapeLikePattern(input.normalizedQuery);
    clauses.push(`${nameNorm} LIKE :searchPhrase ESCAPE '\\\\'`);
    params.searchPhrase = `%${phrase}%`;

    input.tokens.forEach((token, index) => {
      const likeKey = `searchTok${index}`;
      const prefixKey = `searchTokPrefix${index}`;
      const escaped = escapeLikePattern(token);
      clauses.push(
        `(${nameNorm} LIKE :${likeKey} ESCAPE '\\\\' OR ${brandNameNorm} LIKE :${likeKey} ESCAPE '\\\\' OR ${brandSourceNorm} LIKE :${likeKey} ESCAPE '\\\\' OR ${categoryNameNorm} LIKE :${likeKey} ESCAPE '\\\\')`,
      );
      params[likeKey] = `%${escaped}%`;

      if (token.length >= 3) {
        clauses.push(`${nameNorm} LIKE :${prefixKey} ESCAPE '\\\\'`);
        params[prefixKey] = `${escaped.slice(
          0,
          Math.max(3, escaped.length - 1),
        )}%`;
      }
    });

    qb.andWhere(`(${clauses.join(' OR ')})`, params);
  }

  private async resolveExactBrandIds(
    tokens: string[],
    normalizedQuery: string,
  ): Promise<number[]> {
    const needles = uniqueStrings([normalizedQuery, ...tokens]);
    if (!needles.length) return [];

    const aliasRows: Array<{ brandId: number }> =
      await this.brandAliasRepository
        .createQueryBuilder('alias')
        .select('alias.brandId', 'brandId')
        .where('alias.normalizedAlias IN (:...needles)', { needles })
        .getRawMany();

    const ids = aliasRows.map((r) => Number(r.brandId));

    const brandRows: Array<{ id: number }> = await this.brandRepository
      .createQueryBuilder('brand')
      .select('brand.id', 'id')
      .where(
        `${persianNormalizeSql(
          'brand.name',
        )} IN (:...needles) OR ${persianNormalizeSql(
          'brand.sourceName',
        )} IN (:...needles)`,
        { needles },
      )
      .getRawMany();

    return uniqueNums([...ids, ...brandRows.map((b) => Number(b.id))]);
  }

  private async resolveTypoBrandIds(tokens: string[]): Promise<number[]> {
    const aliasRows: BrandAliasRow[] = await this.brandAliasRepository
      .createQueryBuilder('alias')
      .select('alias.brandId', 'brandId')
      .addSelect('alias.normalizedAlias', 'normalizedAlias')
      .getRawMany();

    if (!aliasRows.length) return [];

    const byAlias = new Map<string, number>();
    for (const row of aliasRows) {
      byAlias.set(String(row.normalizedAlias), Number(row.brandId));
    }
    const aliasList = [...byAlias.keys()];
    const ids: number[] = [];

    for (const token of tokens) {
      if (token.length < 3) continue;
      const hit = lightTypoMatch(token, aliasList, {
        maxDistance: token.length >= 6 ? 2 : 1,
        minLength: 3,
      });
      if (hit) {
        const brandId = byAlias.get(hit);
        if (brandId) ids.push(brandId);
      }
    }
    return uniqueNums(ids);
  }

  private resolveCategoryMatch(
    normalizedQuery: string,
    tokens: string[],
    scopeData: CanonicalEligibilityData,
  ): { canonicalIds: number[]; sourceCategoryIds: number[] } {
    const canonicalIds: number[] = [];
    for (const cat of scopeData.canonicalRows) {
      if (cat.status !== CanonicalCategoryStatus.active) continue;
      const name = normalizeSearchText(cat.name || '');
      if (!name) continue;
      const strong =
        name === normalizedQuery ||
        tokens.some((t) => t.length >= 2 && name === t);
      const contains =
        !strong &&
        tokens.some(
          (t) => t.length >= 3 && (name.includes(t) || t.includes(name)),
        );
      if (strong || contains) {
        canonicalIds.push(cat.id);
      }
    }

    const limitedCanonical = uniqueNums(canonicalIds).slice(0, 12);
    if (!limitedCanonical.length) {
      return { canonicalIds: [], sourceCategoryIds: [] };
    }

    const sourceIds: number[] = [];
    for (const canonicalId of limitedCanonical.slice(0, 3)) {
      const scope = resolveCanonicalCategoryScope(
        canonicalId,
        scopeData.canonicalRows,
        scopeData.mappings,
        scopeData.sourceTaxonomy,
      );
      sourceIds.push(...scope.sourceCategoryIds);
    }

    return {
      canonicalIds: limitedCanonical,
      sourceCategoryIds: uniqueNums(sourceIds),
    };
  }
}

function uniqueNums(values: number[]): number[] {
  return [...new Set(values.filter((n) => Number.isFinite(n) && n > 0))];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}
