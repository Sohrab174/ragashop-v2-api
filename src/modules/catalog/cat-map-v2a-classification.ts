/**
 * CAT-MAP-V2-A — READ-ONLY classification of existing legacy mappings.
 * Does NOT persist results. Does NOT mutate mappings.
 */

import { expandSourceCategoryIds } from './canonical-category-scope.resolver';
import {
  AudienceContext,
  inferAudienceContext,
} from './canonical-presentation-image';

export type MappingClassification =
  | 'SAFE_SINGLE_AUDIENCE'
  | 'MIXED_REVIEW_REQUIRED'
  | 'NEUTRAL'
  | 'UNKNOWN';

export type GenderDistribution = {
  total: number;
  female: number;
  male: number;
  unisex: number;
  unknown: number;
};

export type MappingClassificationInput = {
  mappingId: number;
  sourceCategoryId: number;
  source: string | null;
  sourceName: string | null;
  sourceFaName: string | null;
  providerSourceId: string | null;
  canonicalCategoryId: number;
  canonicalName: string | null;
  canonicalPath: string[];
  rootAudience: AudienceContext;
  rootName: string | null;
  distribution: GenderDistribution;
};

export type MappingClassificationRow = MappingClassificationInput & {
  classification: MappingClassification;
  oppositeShare: number;
  matchingShare: number;
};

const OPPOSITE_NOISE = 0.02;
const MATCH_SAFE = 0.95;

export function emptyDistribution(): GenderDistribution {
  return { total: 0, female: 0, male: 0, unisex: 0, unknown: 0 };
}

export function accumulateProductGender(
  dist: GenderDistribution,
  gender: string | null | undefined,
): void {
  dist.total += 1;
  if (gender === 'female') dist.female += 1;
  else if (gender === 'male') dist.male += 1;
  else if (gender === 'unisex') dist.unisex += 1;
  else dist.unknown += 1;
}

export function resolveCanonicalRoot(
  canonicalId: number,
  rows: Array<{
    id: number;
    parentId: number | null;
    name?: string | null;
    audience?: string | null;
  }>,
): { rootId: number; rootName: string | null; rootAudience: AudienceContext } {
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  let cur = byId.get(Number(canonicalId));
  const seen = new Set<number>();
  while (cur && cur.parentId != null && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(Number(cur.parentId));
  }
  if (!cur) {
    return { rootId: canonicalId, rootName: null, rootAudience: 'neutral' };
  }
  const fromField = cur.audience
    ? inferAudienceContext(cur.audience)
    : 'neutral';
  const rootAudience =
    fromField !== 'neutral' ? fromField : inferAudienceContext(cur.name);
  return {
    rootId: cur.id,
    rootName: cur.name ?? null,
    rootAudience,
  };
}

export function buildCanonicalPath(
  canonicalId: number,
  rows: Array<{ id: number; parentId: number | null; name?: string | null }>,
): string[] {
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const path: string[] = [];
  let cur = byId.get(Number(canonicalId));
  const seen = new Set<number>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(String(cur.name || cur.id));
    if (cur.parentId == null) break;
    cur = byId.get(Number(cur.parentId));
  }
  return path;
}

/**
 * Expand one mapping's affected source category ids using PLP same-source rules.
 */
export function expandMappingSourceScope(
  mapping: { sourceCategoryId: number; source?: string | null },
  taxonomy: Array<{
    id: number;
    parentId: number | null;
    source?: string | null;
    status?: string;
  }>,
): number[] {
  return expandSourceCategoryIds(
    [
      {
        sourceCategoryId: Number(mapping.sourceCategoryId),
        source: mapping.source,
      },
    ],
    taxonomy,
  );
}

export function classifyLegacyMapping(input: {
  rootAudience: AudienceContext;
  distribution: GenderDistribution;
}): {
  classification: MappingClassification;
  oppositeShare: number;
  matchingShare: number;
} {
  const { rootAudience, distribution } = input;
  const total = distribution.total;
  if (total <= 0) {
    return {
      classification: 'UNKNOWN',
      oppositeShare: 0,
      matchingShare: 0,
    };
  }

  if (rootAudience === 'neutral' || rootAudience === 'kids') {
    return {
      classification: 'NEUTRAL',
      oppositeShare: 0,
      matchingShare: 0,
    };
  }

  const matching =
    rootAudience === 'women' ? distribution.female : distribution.male;
  const opposite =
    rootAudience === 'women' ? distribution.male : distribution.female;
  const matchingShare = matching / total;
  const oppositeShare = opposite / total;

  // Any opposite-gender product under a gendered root needs human review.
  if (opposite > 0 || oppositeShare >= OPPOSITE_NOISE) {
    return {
      classification: 'MIXED_REVIEW_REQUIRED',
      oppositeShare,
      matchingShare,
    };
  }

  if (matchingShare >= MATCH_SAFE) {
    return {
      classification: 'SAFE_SINGLE_AUDIENCE',
      oppositeShare,
      matchingShare,
    };
  }

  // Gendered root but weak/ambiguous distribution (mostly null/unisex).
  if (matching === 0) {
    return {
      classification: 'UNKNOWN',
      oppositeShare,
      matchingShare,
    };
  }

  return {
    classification: 'MIXED_REVIEW_REQUIRED',
    oppositeShare,
    matchingShare,
  };
}

export function classifyLegacyMappingRow(
  input: MappingClassificationInput,
): MappingClassificationRow {
  const result = classifyLegacyMapping({
    rootAudience: input.rootAudience,
    distribution: input.distribution,
  });
  return { ...input, ...result };
}
