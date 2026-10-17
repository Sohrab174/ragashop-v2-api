/**
 * Read-time storefront discovery guards.
 *
 * Reuses CAT-3B audience genders and classifyGenderRelevance / refineGenderRelevance.
 * Does not write product.gender and does not add classification rules.
 * Product detail, cart, and checkout do not use this module.
 */

import { createHash } from 'crypto';
import { Logger } from '@nestjs/common';
import { SelectQueryBuilder } from 'typeorm';
import { ProductGender } from '../product/entities/product.entity';
import {
  eligibleProductGendersForAudience,
  isAdultAudienceBrowse,
} from './canonical-audience-policy';
import {
  CanonicalProductEligibility,
  SLICE_ELIGIBLE_PRODUCT_GENDERS,
} from './canonical-product-eligibility';
import { SourceCategoryMappingGenderSlice } from './entities/source-category-mapping.entity';
import {
  classifyGenderRelevance,
  GenderRelevanceAttribute,
  GenderRelevanceDecision,
  refineGenderRelevance,
} from './gender-relevance';
import { unresolvedGenderSql } from './gender-review.util';

const logger = new Logger('StorefrontGenderSafety');
const CACHE_MS = 60_000;
const QUERY_CHUNK = 400;

export type StorefrontGenderSafetySnapshot = {
  reviewableCategoryIds: number[];
  /** Null-gender products the existing classifier marks not applicable. */
  neutralExceptionProductIds: number[];
  /** kids_footwear / kids_apparel, including products that already have a gender. */
  kidsExclusionProductIds: number[];
};

export const EMPTY_STOREFRONT_GENDER_SAFETY: StorefrontGenderSafetySnapshot = {
  reviewableCategoryIds: [],
  neutralExceptionProductIds: [],
  kidsExclusionProductIds: [],
};

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
};

let cache: { at: number; snapshot: StorefrontGenderSafetySnapshot } | null =
  null;
let inflight: Promise<StorefrontGenderSafetySnapshot> | null = null;

export function clearStorefrontGenderSafetyCache(): void {
  cache = null;
  inflight = null;
}

export function isAdultListingKidsExclusion(
  decision: GenderRelevanceDecision,
): boolean {
  return (
    decision.reason === 'kids_footwear' || decision.reason === 'kids_apparel'
  );
}

/** True when a product still needs an adult gender and must leave gender-specific discovery. */
export function isUnresolvedGenderDiscoveryProduct(
  gender: string | null | undefined,
  decision: GenderRelevanceDecision,
): boolean {
  if (!decision.reviewable) return false;
  return (
    gender == null ||
    gender === '' ||
    (gender !== ProductGender.female &&
      gender !== ProductGender.male &&
      gender !== ProductGender.unisex)
  );
}

function sqlGenderList(genders: readonly string[]): string {
  return genders.map((gender) => `'${gender}'`).join(', ');
}

/**
 * Homepage section pins. Null and child sections do not add a gender predicate.
 * Female/male reuse CAT-3B (include unisex). Unisex reuses the unisex slice.
 */
export function homepageSectionProductGenderSql(
  sectionAlias: string,
  productAlias: string,
): string {
  const women = sqlGenderList(eligibleProductGendersForAudience('women'));
  const men = sqlGenderList(eligibleProductGendersForAudience('men'));
  const unisex = sqlGenderList(
    SLICE_ELIGIBLE_PRODUCT_GENDERS[SourceCategoryMappingGenderSlice.unisex] ||
      [],
  );
  return `(
    ${sectionAlias}.productGender IS NULL
    OR ${sectionAlias}.productGender = 'child'
    OR (${sectionAlias}.productGender = 'female' AND ${productAlias}.gender IN (${women}))
    OR (${sectionAlias}.productGender = 'male' AND ${productAlias}.gender IN (${men}))
    OR (${sectionAlias}.productGender = 'unisex' AND ${productAlias}.gender IN (${unisex}))
  )`;
}

type GenderFilterGroup = {
  logicalOperator?: string;
  data?: Array<{
    field?: string;
    comparisonOperator?: string;
    value?: unknown;
  }>;
};

/**
 * Pull an equality gender filter out of the legacy product list filters.
 * Other operators stay on the generic filter path.
 */
export function splitEqualityGenderFilter<T extends GenderFilterGroup>(
  filters: T[] | null | undefined,
): { filters: T[]; gender: string | null } {
  let gender: string | null = null;
  const next: T[] = [];
  for (const group of filters || []) {
    const data = [];
    for (const item of group.data || []) {
      if (item.field === 'gender' && item.comparisonOperator === '=') {
        if (gender == null && item.value != null && item.value !== '') {
          gender = String(item.value);
        }
        continue;
      }
      data.push(item);
    }
    if (data.length) next.push({ ...group, data });
  }
  return { filters: next, gender };
}

/**
 * Legacy homepage product query (`GET /products?gender=`).
 * child / empty / unknown: no predicate, so gender-neutral and children's
 * sections stay populated. female / male: CAT-3B. unisex: unisex slice.
 */
export function legacyListingGenderPredicate(
  alias: string,
  gender: string | null | undefined,
): { sql: string; params: Record<string, unknown> } | null {
  if (gender == null || gender === '' || gender === 'all' || gender === 'child') {
    return null;
  }
  if (gender === ProductGender.female) {
    return {
      sql: `${alias}.gender IN (:...sectionGenders)`,
      params: { sectionGenders: [...eligibleProductGendersForAudience('women')] },
    };
  }
  if (gender === ProductGender.male) {
    return {
      sql: `${alias}.gender IN (:...sectionGenders)`,
      params: { sectionGenders: [...eligibleProductGendersForAudience('men')] },
    };
  }
  if (gender === ProductGender.unisex) {
    return {
      sql: `${alias}.gender IN (:...sectionGenders)`,
      params: {
        sectionGenders: [
          ...(SLICE_ELIGIBLE_PRODUCT_GENDERS[
            SourceCategoryMappingGenderSlice.unisex
          ] || []),
        ],
      },
    };
  }
  return null;
}

export function applyUnresolvedGenderDiscoveryFilter<T>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  snapshot: StorefrontGenderSafetySnapshot,
): SelectQueryBuilder<T> {
  if (!snapshot.reviewableCategoryIds.length) return qb;
  const params: Record<string, unknown> = {
    unresolvedReviewableCategoryIds: snapshot.reviewableCategoryIds,
  };
  let sql = `(${unresolvedGenderSql(alias)} AND ${alias}.categoryId IN (:...unresolvedReviewableCategoryIds)`;
  if (snapshot.neutralExceptionProductIds.length) {
    sql += ` AND ${alias}.id NOT IN (:...unresolvedNeutralProductIds)`;
    params.unresolvedNeutralProductIds = snapshot.neutralExceptionProductIds;
  }
  sql += ')';
  qb.andWhere(`NOT ${sql}`, params);
  return qb;
}

export function applyAdultListingKidsExclusion<T>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  eligibility: Pick<CanonicalProductEligibility, 'audience' | 'audienceGenders'>,
  kidsProductIds: readonly number[],
): SelectQueryBuilder<T> {
  if (!isAdultAudienceBrowse(eligibility.audience)) return qb;
  if (!eligibility.audienceGenders?.length || !kidsProductIds.length) return qb;
  qb.andWhere(`${alias}.id NOT IN (:...adultKidsExclusionIds)`, {
    adultKidsExclusionIds: [...kidsProductIds],
  });
  return qb;
}

export function kidsExclusionCacheToken(ids: readonly number[]): string {
  if (!ids.length) return '';
  return createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 12);
}

function canQuery(manager: unknown): manager is Queryable {
  return Boolean(manager && typeof (manager as { query?: unknown }).query === 'function');
}

export async function loadStorefrontGenderSafetySnapshot(
  manager: unknown,
): Promise<StorefrontGenderSafetySnapshot> {
  if (!canQuery(manager)) return EMPTY_STOREFRONT_GENDER_SAFETY;
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.snapshot;
  // Homepage and Concept D fan out many catalog reads at once. Without a
  // shared flight, each one loads every reviewable product attribute set.
  if (inflight) return inflight;
  const flight = computeStorefrontGenderSafety(manager)
    .then((snapshot) => {
      cache = { at: Date.now(), snapshot };
      return snapshot;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`storefront gender safety snapshot skipped: ${message}`);
      return EMPTY_STOREFRONT_GENDER_SAFETY;
    })
    .finally(() => {
      if (inflight === flight) inflight = null;
    });
  inflight = flight;
  return flight;
}

async function computeStorefrontGenderSafety(
  manager: Queryable,
): Promise<StorefrontGenderSafetySnapshot> {
  const categories = (await manager.query(
    'SELECT id, hierarchy, gender, bankTypeName FROM category',
  )) as Array<{
    id: number;
    hierarchy: string | null;
    gender: string | null;
    bankTypeName: string | null;
  }>;

  const domainById = new Map<number, string | null>();
  try {
    const domains = (await manager.query(
      'SELECT categoryId, businessDomain FROM category_assortment_resolution',
    )) as Array<{ categoryId: number; businessDomain: string | null }>;
    for (const row of domains || []) {
      domainById.set(Number(row.categoryId), row.businessDomain ?? null);
    }
  } catch {
    // Domain is one classifier input. Missing resolution data stays null.
  }

  const relevance = new Map<number, GenderRelevanceDecision>();
  const reviewableCategoryIds: number[] = [];
  const refineCategoryIds: number[] = [];
  for (const category of categories || []) {
    const id = Number(category.id);
    if (!id || id === 1) continue;
    const decision = classifyGenderRelevance({
      hierarchy: category.hierarchy,
      businessDomain: domainById.get(id) ?? null,
      categoryGender: category.gender,
    });
    relevance.set(id, decision);
    if (decision.reviewable) reviewableCategoryIds.push(id);
    if (
      decision.reviewable &&
      (decision.reason === 'footwear' || decision.reason === 'adult_apparel')
    ) {
      refineCategoryIds.push(id);
    }
  }

  const products = await loadProductsInCategories(manager, refineCategoryIds);
  const attributes = await loadGenderAttributes(
    manager,
    products.map((row) => row.id),
  );

  const kidsExclusionProductIds: number[] = [];
  const neutralExceptionProductIds: number[] = [];
  for (const product of products) {
    const category = relevance.get(product.categoryId);
    if (!category) continue;
    const refined = refineGenderRelevance(category, {
      name: product.name,
      sourceName: product.sourceName,
      ageGroup: product.ageGroup,
      attributes: attributes.get(product.id) ?? [],
    });
    if (isAdultListingKidsExclusion(refined)) {
      kidsExclusionProductIds.push(product.id);
    }
    if (
      isUnresolvedGenderDiscoveryProduct(product.gender, category) &&
      !isUnresolvedGenderDiscoveryProduct(product.gender, refined)
    ) {
      neutralExceptionProductIds.push(product.id);
    }
  }

  return {
    reviewableCategoryIds: uniqueSorted(reviewableCategoryIds),
    neutralExceptionProductIds: uniqueSorted(neutralExceptionProductIds),
    kidsExclusionProductIds: uniqueSorted(kidsExclusionProductIds),
  };
}

type ProductSignalRow = {
  id: number;
  name: string | null;
  sourceName: string | null;
  ageGroup: string | null;
  categoryId: number;
  gender: string | null;
};

async function loadProductsInCategories(
  manager: Queryable,
  categoryIds: number[],
): Promise<ProductSignalRow[]> {
  const rows: ProductSignalRow[] = [];
  for (const chunk of chunks(uniqueSorted(categoryIds), QUERY_CHUNK)) {
    const placeholders = chunk.map(() => '?').join(',');
    const batch = (await manager.query(
      `SELECT p.id AS id, p.name AS name, p.sourceName AS sourceName,
              p.ageGroup AS ageGroup, p.categoryId AS categoryId, p.gender AS gender
       FROM product p
       WHERE p.isDeleted = 0 AND p.categoryId IN (${placeholders})`,
      chunk,
    )) as ProductSignalRow[];
    for (const row of batch || []) {
      rows.push({
        id: Number(row.id),
        name: row.name ?? null,
        sourceName: row.sourceName ?? null,
        ageGroup: row.ageGroup ?? null,
        categoryId: Number(row.categoryId),
        gender: row.gender ?? null,
      });
    }
  }
  return rows.filter((row) => row.id > 0);
}

async function loadGenderAttributes(
  manager: Queryable,
  productIds: number[],
): Promise<Map<number, GenderRelevanceAttribute[]>> {
  const grouped = new Map<number, GenderRelevanceAttribute[]>();
  for (const chunk of chunks(uniqueSorted(productIds), QUERY_CHUNK)) {
    const placeholders = chunk.map(() => '?').join(',');
    const rows = (await manager.query(
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
      chunk,
    )) as Array<GenderRelevanceAttribute & { productId?: number }>;
    for (const row of rows || []) {
      const productId = Number(row.productId);
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
  }
  return grouped;
}

function uniqueSorted(ids: number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))].sort(
    (a, b) => a - b,
  );
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
