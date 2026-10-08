/**
 * CAT-MAP-V2-C — computed routingStatus + source-level classification.
 *
 * classification = diagnostic (never persisted)
 * reviewStatus   = persisted workflow state
 * routingStatus  = computed readiness for the employee UI
 *
 * Reuses V2-A classifyLegacyMapping when a canonical root audience is known.
 */

import {
  classifyLegacyMapping,
  GenderDistribution,
  MappingClassification,
} from './cat-map-v2a-classification';
import { AudienceContext } from './canonical-presentation-image';
import {
  SourceCategoryMappingGenderSlice,
  SourceCategoryMappingReviewStatus,
  SourceCategoryMappingStatus,
} from './entities/source-category-mapping.entity';

export type MappingRoutingStatus =
  | 'UNMAPPED'
  | 'UNREVIEWED'
  | 'PARTIAL'
  | 'COMPLETE'
  | 'NEEDS_REVIEW';

export type SourceMappingRuleRow = {
  genderSlice: string;
  status: string;
  reviewStatus: string;
  canonicalCategoryId: number;
  canonicalAudience?: AudienceContext | null;
};

const REVIEWED = new Set<string>([
  SourceCategoryMappingReviewStatus.reviewed_ok,
  SourceCategoryMappingReviewStatus.migrated,
]);

function isActive(rule: SourceMappingRuleRow): boolean {
  return rule.status === SourceCategoryMappingStatus.active;
}

function hasProducts(dist: GenderDistribution, gender: 'female' | 'male') {
  return dist[gender] > 0;
}

/**
 * Source-level classification for Admin detail / review queue.
 * Prefer destination root audience when an active mapping exists;
 * otherwise infer from product distribution alone.
 */
export function classifySourceCategoryScope(input: {
  distribution: GenderDistribution;
  /** Root audience of the primary active mapping destination, if any. */
  destinationRootAudience?: AudienceContext | null;
}): {
  classification: MappingClassification;
  oppositeShare: number;
  matchingShare: number;
} {
  const { distribution, destinationRootAudience } = input;
  if (distribution.total <= 0) {
    return { classification: 'UNKNOWN', oppositeShare: 0, matchingShare: 0 };
  }

  if (destinationRootAudience) {
    return classifyLegacyMapping({
      rootAudience: destinationRootAudience,
      distribution,
    });
  }

  const hasFemale = hasProducts(distribution, 'female');
  const hasMale = hasProducts(distribution, 'male');
  if (hasFemale && hasMale) {
    return {
      classification: 'MIXED_REVIEW_REQUIRED',
      oppositeShare:
        Math.min(distribution.female, distribution.male) / distribution.total,
      matchingShare:
        Math.max(distribution.female, distribution.male) / distribution.total,
    };
  }
  if (hasFemale || hasMale) {
    const matching = hasFemale ? distribution.female : distribution.male;
    return {
      classification:
        matching / distribution.total >= 0.95
          ? 'SAFE_SINGLE_AUDIENCE'
          : 'MIXED_REVIEW_REQUIRED',
      oppositeShare: 0,
      matchingShare: matching / distribution.total,
    };
  }
  if (distribution.unisex > 0 && distribution.unknown === 0) {
    return { classification: 'NEUTRAL', oppositeShare: 0, matchingShare: 0 };
  }
  return { classification: 'UNKNOWN', oppositeShare: 0, matchingShare: 0 };
}

/**
 * Employee-facing routing readiness.
 * Legacy any + legacy_unreviewed is NEVER COMPLETE even if CAT-3B filters PLP.
 */
export function resolveMappingRoutingStatus(input: {
  distribution: GenderDistribution;
  rules: SourceMappingRuleRow[];
  classification: MappingClassification;
}): MappingRoutingStatus {
  const active = input.rules.filter(isActive);
  if (!active.length) return 'UNMAPPED';

  if (
    active.some(
      (r) => r.reviewStatus === SourceCategoryMappingReviewStatus.needs_review,
    )
  ) {
    return 'NEEDS_REVIEW';
  }

  const anyRules = active.filter(
    (r) => r.genderSlice === SourceCategoryMappingGenderSlice.any,
  );
  const femaleRules = active.filter(
    (r) => r.genderSlice === SourceCategoryMappingGenderSlice.female,
  );
  const maleRules = active.filter(
    (r) => r.genderSlice === SourceCategoryMappingGenderSlice.male,
  );

  const hasLegacyAny = anyRules.some(
    (r) =>
      r.reviewStatus === SourceCategoryMappingReviewStatus.legacy_unreviewed,
  );
  if (hasLegacyAny && !femaleRules.length && !maleRules.length) {
    return 'UNREVIEWED';
  }

  const reviewedFemale = femaleRules.some((r) => REVIEWED.has(r.reviewStatus));
  const reviewedMale = maleRules.some((r) => REVIEWED.has(r.reviewStatus));
  const reviewedAny = anyRules.some((r) => REVIEWED.has(r.reviewStatus));

  const needsFemale = hasProducts(input.distribution, 'female');
  const needsMale = hasProducts(input.distribution, 'male');

  if (input.classification === 'NEUTRAL') {
    if (reviewedAny || (reviewedFemale && reviewedMale)) return 'COMPLETE';
    if (reviewedFemale || reviewedMale || reviewedAny) return 'PARTIAL';
    if (hasLegacyAny) return 'UNREVIEWED';
    return 'PARTIAL';
  }

  if (needsFemale && needsMale) {
    if (reviewedFemale && reviewedMale) return 'COMPLETE';
    if (reviewedFemale || reviewedMale) return 'PARTIAL';
    if (hasLegacyAny) return 'UNREVIEWED';
    return 'PARTIAL';
  }

  if (needsFemale) {
    if (reviewedFemale) return 'COMPLETE';
    if (hasLegacyAny) return 'UNREVIEWED';
    if (reviewedAny) {
      // Reviewed any into a single-audience destination is not V2 slice-complete.
      return 'PARTIAL';
    }
    return 'PARTIAL';
  }

  if (needsMale) {
    if (reviewedMale) return 'COMPLETE';
    if (hasLegacyAny) return 'UNREVIEWED';
    if (reviewedAny) return 'PARTIAL';
    return 'PARTIAL';
  }

  // No adult gendered products (null/unisex only).
  if (reviewedAny || reviewedFemale || reviewedMale) return 'COMPLETE';
  if (hasLegacyAny) return 'UNREVIEWED';
  return 'PARTIAL';
}

/** Primary destination for classification: prefer reviewed slices, else any. */
export function pickPrimaryDestinationAudience(
  rules: SourceMappingRuleRow[],
): AudienceContext | null {
  const active = rules.filter(isActive);
  const preferred =
    active.find(
      (r) =>
        REVIEWED.has(r.reviewStatus) &&
        (r.genderSlice === SourceCategoryMappingGenderSlice.female ||
          r.genderSlice === SourceCategoryMappingGenderSlice.male),
    ) ||
    active.find(
      (r) => r.genderSlice === SourceCategoryMappingGenderSlice.any,
    ) ||
    active[0];
  return preferred?.canonicalAudience ?? null;
}
