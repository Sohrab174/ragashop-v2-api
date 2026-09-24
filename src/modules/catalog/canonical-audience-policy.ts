/**
 * CAT-3B Stage-1 — centralized audience eligibility for canonical PLP.
 *
 * AUTHORITATIVE for audience-specific browse (men/women).
 * Uses structured product.gender — NOT title regex.
 *
 * Kids membership remains structural (canonical↔source mappings);
 * this module does not invent kids = !adult.
 *
 * Temporary: audience resolution prefers canonical_category.audience,
 * then root-name inference via inferAudienceContext (shared with CAT-2 presentation).
 */

import { ProductGender } from '../product/entities/product.entity';
import {
  AudienceContext,
  inferAudienceContext,
} from './canonical-presentation-image';

export type CanonicalAudienceRow = {
  id: number;
  parentId: number | null;
  name?: string | null;
  audience?: string | null;
};

export type AdultAudienceBrowse = 'men' | 'women';

/**
 * Resolve browse audience for a selected canonical category by walking
 * to the root and reading audience metadata (then name inference).
 */
export function resolveCanonicalBrowseAudience(
  selectedId: number,
  rows: CanonicalAudienceRow[],
): AudienceContext {
  const byId = new Map(rows.map((r) => [r.id, r]));
  let cur = byId.get(selectedId);
  const seen = new Set<number>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.parentId == null) {
      if (cur.audience) {
        const fromField = inferAudienceContext(cur.audience);
        if (fromField !== 'neutral') return fromField;
      }
      return inferAudienceContext(cur.name);
    }
    cur = byId.get(cur.parentId) ?? null;
  }
  return 'neutral';
}

export function isAdultAudienceBrowse(
  audience: AudienceContext,
): audience is AdultAudienceBrowse {
  return audience === 'men' || audience === 'women';
}

/**
 * Eligible product.gender values for adult audience PLP.
 * - men: male + unisex
 * - women: female + unisex
 * - null/unknown: EXCLUDED (fail-closed) for adult audience roots
 */
export function eligibleProductGendersForAudience(
  audience: AdultAudienceBrowse,
): ProductGender[] {
  if (audience === 'men') {
    return [ProductGender.male, ProductGender.unisex];
  }
  return [ProductGender.female, ProductGender.unisex];
}

/** Conflicting explicit gender that must never appear in the other adult root. */
export function conflictingProductGenderForAudience(
  audience: AdultAudienceBrowse,
): ProductGender {
  return audience === 'men' ? ProductGender.female : ProductGender.male;
}
