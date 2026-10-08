/**
 * CAT-MAP-V2-B — shared canonical category → Product eligibility.
 *
 * ONE interpretation consumed by storefront PLP and category-scoped Search.
 * Resolves category eligibility only: no text matching, sorting, pagination,
 * pricing or commerce filters. Never mutates.
 *
 * Flow:
 *   selected canonical (+ active descendants)
 *     → active mapping rules
 *     → mapped source categories (+ SAME-SOURCE descendants)
 *     → per-slice product.gender predicate
 *     → CAT-3B adult audience intersection (defense in depth)
 *
 * Slice semantics:
 *   any    → no mapping-level gender restriction (legacy + reviewed neutral)
 *   female → product.gender IN (female, unisex)
 *   male   → product.gender IN (male, unisex)
 *   unisex → product.gender = unisex
 * There is no unknown/null slice; null gender only passes through `any`
 * and only where CAT-3B does not apply (kids / neutral roots).
 *
 * Rollout: female/male/unisex rows only route when slice routing is enabled
 * (CATALOG_MAPPING_V2=1) AND the row is reviewed. Otherwise they contribute
 * nothing (fail-closed). `any` rows always route exactly like V1.
 */

import { SelectQueryBuilder } from 'typeorm';
import { ProductGender } from '../product/entities/product.entity';
import {
  eligibleProductGendersForAudience,
  isAdultAudienceBrowse,
  resolveCanonicalBrowseAudience,
} from './canonical-audience-policy';
import {
  CanonicalScopeRow,
  collectActiveCanonicalScopeIds,
  collectActiveMappingsInScope,
  expandSourceCategoryIds,
  resolveCanonicalCategoryScope,
  SourceMappingScopeRow,
  SourceTaxonomyScopeRow,
} from './canonical-category-scope.resolver';
import { AudienceContext } from './canonical-presentation-image';
import {
  SourceCategoryMappingGenderSlice,
  SourceCategoryMappingReviewStatus,
} from './entities/source-category-mapping.entity';
import {
  isAssortmentDiscoveryEnforcementEnabled,
  subtractNonInScopeFromClauses,
} from './assortment-policy/assortment-enforcement';

export const CATALOG_MAPPING_V2_ENV = 'CATALOG_MAPPING_V2';

/** Slice routing for female/male/unisex rows. Default OFF. */
export function isCatalogMappingV2SliceRoutingEnabled(): boolean {
  return process.env[CATALOG_MAPPING_V2_ENV] === '1';
}

/** Review states under which a non-`any` slice row may route products. */
export const ROUTABLE_SLICE_REVIEW_STATUSES: ReadonlySet<string> = new Set([
  SourceCategoryMappingReviewStatus.reviewed_ok,
  SourceCategoryMappingReviewStatus.migrated,
]);

export const SLICE_ELIGIBLE_PRODUCT_GENDERS: Readonly<
  Record<SourceCategoryMappingGenderSlice, readonly ProductGender[] | null>
> = {
  [SourceCategoryMappingGenderSlice.any]: null,
  [SourceCategoryMappingGenderSlice.female]: [
    ProductGender.female,
    ProductGender.unisex,
  ],
  [SourceCategoryMappingGenderSlice.male]: [
    ProductGender.male,
    ProductGender.unisex,
  ],
  [SourceCategoryMappingGenderSlice.unisex]: [ProductGender.unisex],
};

const NARROW_SLICES: SourceCategoryMappingGenderSlice[] = [
  SourceCategoryMappingGenderSlice.female,
  SourceCategoryMappingGenderSlice.male,
  SourceCategoryMappingGenderSlice.unisex,
];

export type EligibilityCanonicalRow = CanonicalScopeRow & {
  audience?: string | null;
};

export type EligibilityMappingRow = SourceMappingScopeRow & {
  genderSlice?: string | null;
  reviewStatus?: string | null;
};

export type CanonicalEligibilityData = {
  canonicalRows: EligibilityCanonicalRow[];
  mappings: EligibilityMappingRow[];
  sourceTaxonomy: SourceTaxonomyScopeRow[];
  /**
   * SCOPE-5/6 — when present and discovery enforcement is on, non-IN source
   * categories are subtracted from expanded mapping scopes (ancestor leakage fix).
   */
  assortmentStatusByCategoryId?: Map<number, string> | Record<number, string>;
};

export type CanonicalEligibilityClause = {
  slice: SourceCategoryMappingGenderSlice;
  sourceCategoryIds: number[];
  /** null → no mapping-level gender restriction. */
  genders: ProductGender[] | null;
};

export type CanonicalProductEligibility = {
  selectedCanonicalId: number;
  canonicalCategoryIds: number[];
  audience: AudienceContext;
  /** CAT-3B adult intersection; null for kids / neutral roots. */
  audienceGenders: ProductGender[] | null;
  /** At most one clause per slice; category ids disjoint across clauses. */
  clauses: CanonicalEligibilityClause[];
  /** Union of all clause scopes (sorted). Empty → no eligible products. */
  sourceCategoryIds: number[];
  diagnostics: {
    legacyAnyMappings: number;
    reviewedAnyMappings: number;
    routedSliceMappings: number;
    ignoredSliceMappings: number;
  };
};

function normalizeSlice(
  value: string | null | undefined,
): SourceCategoryMappingGenderSlice | null {
  if (value == null || value === '')
    return SourceCategoryMappingGenderSlice.any;
  return (Object.values(SourceCategoryMappingGenderSlice) as string[]).includes(
    value,
  )
    ? (value as SourceCategoryMappingGenderSlice)
    : null;
}

function isLegacyReview(reviewStatus: string | null | undefined): boolean {
  return (
    reviewStatus == null ||
    reviewStatus === SourceCategoryMappingReviewStatus.legacy_unreviewed
  );
}

export function resolveCanonicalProductEligibility(
  selectedCanonicalId: number,
  data: CanonicalEligibilityData,
  options?: {
    sliceRoutingEnabled?: boolean;
    maxCanonicalDepth?: number;
    maxSourceNodesPerRoot?: number;
  },
): CanonicalProductEligibility {
  const sliceRoutingEnabled = options?.sliceRoutingEnabled ?? false;

  const audience = resolveCanonicalBrowseAudience(
    selectedCanonicalId,
    data.canonicalRows,
  );
  const audienceGenders = isAdultAudienceBrowse(audience)
    ? eligibleProductGendersForAudience(audience)
    : null;

  const canonicalCategoryIds = collectActiveCanonicalScopeIds(
    selectedCanonicalId,
    data.canonicalRows,
    { maxDepth: options?.maxCanonicalDepth },
  );
  const canonicalScope = new Set(canonicalCategoryIds);

  const anyRows: EligibilityMappingRow[] = [];
  const sliceRows = new Map<
    SourceCategoryMappingGenderSlice,
    EligibilityMappingRow[]
  >();
  const diagnostics = {
    legacyAnyMappings: 0,
    reviewedAnyMappings: 0,
    routedSliceMappings: 0,
    ignoredSliceMappings: 0,
  };

  for (const row of data.mappings) {
    const slice = normalizeSlice(row.genderSlice);
    const inScope =
      row.status === 'active' && canonicalScope.has(row.canonicalCategoryId);

    if (slice === SourceCategoryMappingGenderSlice.any) {
      anyRows.push(row);
      if (inScope) {
        if (isLegacyReview(row.reviewStatus)) diagnostics.legacyAnyMappings++;
        else diagnostics.reviewedAnyMappings++;
      }
      continue;
    }

    const routable =
      slice != null &&
      sliceRoutingEnabled &&
      ROUTABLE_SLICE_REVIEW_STATUSES.has(String(row.reviewStatus || ''));
    if (!routable) {
      if (inScope) diagnostics.ignoredSliceMappings++;
      continue;
    }
    if (inScope) diagnostics.routedSliceMappings++;
    const list = sliceRows.get(slice) || [];
    list.push(row);
    sliceRows.set(slice, list);
  }

  // `any` rows go through the unchanged V1 resolver → identical legacy scope.
  const anyScope = resolveCanonicalCategoryScope(
    selectedCanonicalId,
    data.canonicalRows,
    anyRows,
    data.sourceTaxonomy,
    {
      maxCanonicalDepth: options?.maxCanonicalDepth,
      maxSourceNodesPerRoot: options?.maxSourceNodesPerRoot,
    },
  ).sourceCategoryIds;

  const clauses: CanonicalEligibilityClause[] = [];
  const claimed = new Set<number>(anyScope);
  if (anyScope.length) {
    clauses.push({
      slice: SourceCategoryMappingGenderSlice.any,
      sourceCategoryIds: anyScope,
      genders: null,
    });
  }

  const narrowIds = new Map<SourceCategoryMappingGenderSlice, number[]>();
  for (const slice of NARROW_SLICES) {
    const rows = sliceRows.get(slice);
    if (!rows?.length) continue;
    const inScope = collectActiveMappingsInScope(canonicalCategoryIds, rows);
    const expanded = expandSourceCategoryIds(inScope, data.sourceTaxonomy, {
      maxNodesPerRoot: options?.maxSourceNodesPerRoot,
    });
    narrowIds.set(
      slice,
      expanded.filter((id) => !claimed.has(id)),
    );
  }

  // unisex ⊂ female/male gender sets → drop redundant unisex ids.
  const femaleOrMale = new Set<number>([
    ...(narrowIds.get(SourceCategoryMappingGenderSlice.female) || []),
    ...(narrowIds.get(SourceCategoryMappingGenderSlice.male) || []),
  ]);
  const unisexIds = narrowIds.get(SourceCategoryMappingGenderSlice.unisex);
  if (unisexIds) {
    narrowIds.set(
      SourceCategoryMappingGenderSlice.unisex,
      unisexIds.filter((id) => !femaleOrMale.has(id)),
    );
  }

  for (const slice of NARROW_SLICES) {
    const ids = narrowIds.get(slice);
    if (!ids?.length) continue;
    clauses.push({
      slice,
      sourceCategoryIds: ids,
      genders: [...(SLICE_ELIGIBLE_PRODUCT_GENDERS[slice] || [])],
    });
  }

  let finalClauses = clauses;
  if (
    isAssortmentDiscoveryEnforcementEnabled() &&
    data.assortmentStatusByCategoryId
  ) {
    finalClauses = subtractNonInScopeFromClauses(
      clauses,
      data.assortmentStatusByCategoryId,
    );
  }

  const union = new Set<number>();
  for (const clause of finalClauses) {
    for (const id of clause.sourceCategoryIds) union.add(id);
  }

  return {
    selectedCanonicalId,
    canonicalCategoryIds,
    audience,
    audienceGenders,
    clauses: finalClauses,
    sourceCategoryIds: [...union].sort((a, b) => a - b),
    diagnostics,
  };
}

/**
 * SQL predicate for the mapping clauses (CAT-3B excluded — see
 * applyCanonicalProductEligibility). Null when there is nothing eligible.
 * Legacy-only scope collapses to a single `categoryId IN (...)`.
 */
export function buildCanonicalEligibilityClauseSql(
  alias: string,
  eligibility: Pick<CanonicalProductEligibility, 'clauses'>,
  paramPrefix: string,
): { sql: string; params: Record<string, unknown> } | null {
  const clauses = eligibility.clauses.filter((c) => c.sourceCategoryIds.length);
  if (!clauses.length) return null;

  const params: Record<string, unknown> = {};
  const parts = clauses.map((clause, index) => {
    const idsKey = `${paramPrefix}Cat${index}`;
    params[idsKey] = clause.sourceCategoryIds;
    if (!clause.genders) return `${alias}.categoryId IN (:...${idsKey})`;
    const genderKey = `${paramPrefix}Gender${index}`;
    params[genderKey] = clause.genders;
    return `(${alias}.categoryId IN (:...${idsKey}) AND ${alias}.gender IN (:...${genderKey}))`;
  });

  return {
    sql: parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`,
    params,
  };
}

/**
 * Constrain a Product query builder to canonical eligibility.
 * Pure WHERE predicates on product columns — no joins, so a product row can
 * never be duplicated even when it qualifies through several clauses.
 */
export function applyCanonicalProductEligibility<T>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  eligibility: CanonicalProductEligibility,
  paramPrefix: string,
): SelectQueryBuilder<T> {
  const clause = buildCanonicalEligibilityClauseSql(
    alias,
    eligibility,
    paramPrefix,
  );
  if (!clause) {
    qb.andWhere('1 = 0');
    return qb;
  }
  qb.andWhere(clause.sql, clause.params);
  if (eligibility.audienceGenders?.length) {
    qb.andWhere(`${alias}.gender IN (:...${paramPrefix}Audience)`, {
      [`${paramPrefix}Audience`]: eligibility.audienceGenders,
    });
  }
  return qb;
}

/** In-memory reference semantics of the SQL predicate (tests / shadow tooling). */
export function isProductCanonicallyEligible(
  product: { categoryId: number; gender: string | null | undefined },
  eligibility: CanonicalProductEligibility,
): boolean {
  const gender = product.gender ?? null;
  const clauseHit = eligibility.clauses.some(
    (clause) =>
      clause.sourceCategoryIds.includes(Number(product.categoryId)) &&
      (clause.genders == null ||
        (gender != null && clause.genders.includes(gender as ProductGender))),
  );
  if (!clauseHit) return false;
  if (eligibility.audienceGenders?.length) {
    return (
      gender != null &&
      eligibility.audienceGenders.includes(gender as ProductGender)
    );
  }
  return true;
}

/** Stable facet-cache identity for non-legacy clause shapes ('' when V1-shaped). */
export function canonicalEligibilityCacheSuffix(
  eligibility: Pick<CanonicalProductEligibility, 'clauses'>,
): string {
  const narrow = eligibility.clauses.filter(
    (c) => c.slice !== SourceCategoryMappingGenderSlice.any,
  );
  if (!narrow.length) return '';
  return narrow
    .map(
      (c) =>
        `${c.slice}:${[...c.sourceCategoryIds]
          .sort((a, b) => a - b)
          .join(',')}`,
    )
    .join(';');
}
