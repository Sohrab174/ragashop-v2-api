/**
 * CAT-MAP-V2-C — Coverage V2 metric definitions (pure).
 *
 * Distinguishes:
 * - CURRENTLY DISCOVERABLE (V1 structural scope + CAT-3B may already filter)
 * - V2 REVIEWED/ROUTED (explicit reviewed female/male slices)
 *
 * A mixed legacy `any` under men is discoverable-safe via CAT-3B but NOT
 * V2-complete.
 *
 * Denominators are documented on each field in buildCoverageV2Summary.
 */

import { GenderDistribution } from './cat-map-v2a-classification';
import {
  MappingRoutingStatus,
  SourceMappingRuleRow,
} from './cat-map-v2c-routing';
import {
  SourceCategoryMappingGenderSlice,
  SourceCategoryMappingReviewStatus,
  SourceCategoryMappingStatus,
} from './entities/source-category-mapping.entity';

const REVIEWED = new Set<string>([
  SourceCategoryMappingReviewStatus.reviewed_ok,
  SourceCategoryMappingReviewStatus.migrated,
]);

export type CoverageSourceCategoryRow = {
  sourceCategoryId: number;
  routingStatus: MappingRoutingStatus;
  classification: string;
  discoverable: GenderDistribution;
  rules: SourceMappingRuleRow[];
};

export type CoverageV2Summary = {
  denominators: {
    discoverableCatalogProducts: string;
    v2RoutedFemale: string;
    v2RoutedMale: string;
    v2AdultGenderRoutedUnion: string;
    unresolvedUnknownGenderInAdultMappedScopes: string;
    sourceCategoriesNeedingReview: string;
    sourceCategoriesFullyRouted: string;
    sourceCategoriesPartiallyRouted: string;
    sourceCategoriesLegacyUnreviewed: string;
  };
  products: {
    /** A4-discoverable catalog products (status/active/price/stock gates). */
    discoverableCatalogProducts: number;
    /**
     * Discoverable female products in an active reviewed female-slice scope.
     * Denominator: discoverableCatalogProducts.
     */
    v2RoutedFemale: number;
    /** Discoverable male products in an active reviewed male-slice scope. */
    v2RoutedMale: number;
    /**
     * Discoverable unisex products in female OR male reviewed slice scopes
     * (union; counted once).
     */
    v2RoutedUnisexViaAdultSlices: number;
    /**
     * Union of v2RoutedFemale + v2RoutedMale + v2RoutedUnisexViaAdultSlices
     * (no double-count). Unisex without an explicit unisex row still counts
     * when covered by female/male slices.
     */
    v2AdultGenderRoutedUnion: number;
    /**
     * Discoverable null-gender products whose source categoryId lies in any
     * active adult mapping scope (legacy any or V2 slices). Data-quality debt.
     */
    unresolvedUnknownGenderInAdultMappedScopes: number;
    /**
     * Informational: discoverable products currently reachable via ANY active
     * canonical PLP scope (includes legacy any + CAT-3B). NOT V2 completeness.
     */
    currentlyDiscoverableViaActiveScopes: number;
  };
  sourceCategories: {
    totalConsidered: number;
    needingReview: number;
    fullyRouted: number;
    partiallyRouted: number;
    legacyUnreviewed: number;
    unmappedWithDiscoverableProducts: number;
  };
};

export function isReviewedActiveSlice(
  rule: SourceMappingRuleRow,
  slice: SourceCategoryMappingGenderSlice,
): boolean {
  return (
    rule.status === SourceCategoryMappingStatus.active &&
    rule.genderSlice === slice &&
    REVIEWED.has(rule.reviewStatus)
  );
}

export function buildCoverageV2Summary(input: {
  discoverableCatalogProducts: number;
  currentlyDiscoverableViaActiveScopes: number;
  /** Distinct product ids counted into each bucket (already deduped). */
  v2RoutedFemale: number;
  v2RoutedMale: number;
  v2RoutedUnisexViaAdultSlices: number;
  unresolvedUnknownGenderInAdultMappedScopes: number;
  sourceRows: CoverageSourceCategoryRow[];
}): CoverageV2Summary {
  const rows = input.sourceRows;
  const needingReview = rows.filter(
    (r) =>
      r.routingStatus === 'NEEDS_REVIEW' ||
      r.classification === 'MIXED_REVIEW_REQUIRED' ||
      r.routingStatus === 'PARTIAL',
  ).length;
  const fullyRouted = rows.filter((r) => r.routingStatus === 'COMPLETE').length;
  const partiallyRouted = rows.filter(
    (r) => r.routingStatus === 'PARTIAL',
  ).length;
  const legacyUnreviewed = rows.filter(
    (r) => r.routingStatus === 'UNREVIEWED',
  ).length;
  const unmappedWithDiscoverableProducts = rows.filter(
    (r) => r.routingStatus === 'UNMAPPED' && r.discoverable.total > 0,
  ).length;

  const union =
    input.v2RoutedFemale +
    input.v2RoutedMale +
    input.v2RoutedUnisexViaAdultSlices;

  return {
    denominators: {
      discoverableCatalogProducts:
        'Products passing A4 discovery gates (active, not deleted, price>0, stock/commerce, non-stub category).',
      v2RoutedFemale:
        'Discoverable products with gender=female whose categoryId is in an active reviewed female-slice source scope (incl. same-provider descendants).',
      v2RoutedMale:
        'Discoverable products with gender=male whose categoryId is in an active reviewed male-slice source scope.',
      v2AdultGenderRoutedUnion:
        'Distinct discoverable products counted in v2RoutedFemale ∪ v2RoutedMale ∪ unisex-in-adult-slices. Unisex is not double-counted.',
      unresolvedUnknownGenderInAdultMappedScopes:
        'Discoverable products with gender IS NULL whose categoryId is in any active adult mapping scope (legacy any or V2). Not routed into adult gender branches.',
      sourceCategoriesNeedingReview:
        'Source categories with routingStatus PARTIAL/NEEDS_REVIEW or classification MIXED_REVIEW_REQUIRED.',
      sourceCategoriesFullyRouted:
        'Source categories with routingStatus=COMPLETE (reviewed V2 slices or reviewed neutral any). Legacy any is never COMPLETE.',
      sourceCategoriesPartiallyRouted:
        'Source categories with routingStatus=PARTIAL.',
      sourceCategoriesLegacyUnreviewed:
        'Source categories with routingStatus=UNREVIEWED (active any + legacy_unreviewed only).',
    },
    products: {
      discoverableCatalogProducts: input.discoverableCatalogProducts,
      v2RoutedFemale: input.v2RoutedFemale,
      v2RoutedMale: input.v2RoutedMale,
      v2RoutedUnisexViaAdultSlices: input.v2RoutedUnisexViaAdultSlices,
      v2AdultGenderRoutedUnion: union,
      unresolvedUnknownGenderInAdultMappedScopes:
        input.unresolvedUnknownGenderInAdultMappedScopes,
      currentlyDiscoverableViaActiveScopes:
        input.currentlyDiscoverableViaActiveScopes,
    },
    sourceCategories: {
      totalConsidered: rows.length,
      needingReview,
      fullyRouted,
      partiallyRouted,
      legacyUnreviewed,
      unmappedWithDiscoverableProducts,
    },
  };
}
