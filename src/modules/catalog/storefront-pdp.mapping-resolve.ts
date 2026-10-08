/**
 * CAT-MAP-V2 PRE-E — slice-aware PDP breadcrumb mapping selection.
 *
 * Discovery eligibility (V2-B) and PDP breadcrumb are different problems:
 * - V2-B intentionally lets unisex products appear on BOTH female and male
 *   PLP slices when those rows are effective.
 * - PDP must pick ONE deterministic canonical breadcrumb from Product.gender
 *   + effective mapping rules. It must NEVER last-write-wins across slices,
 *   and must NEVER invent female-first / male-first for unisex products.
 *
 * Effective rule parity with V2-B PLP/Search:
 * - `any` always routes (legacy_unreviewed + reviewed)
 * - female/male/unisex only when CATALOG_MAPPING_V2=1 AND reviewStatus in
 *   { reviewed_ok, migrated }
 *
 * Precedence (per source category, Product.gender authoritative):
 *   female  → female → any → none   (never male)
 *   male    → male   → any → none   (never female)
 *   unisex  → unisex → any → none   (never arbitrary female/male)
 *   null    → any → none            (never infer gender)
 */

import { ProductGender } from '../product/entities/product.entity';
import {
  isCatalogMappingV2SliceRoutingEnabled,
  ROUTABLE_SLICE_REVIEW_STATUSES,
} from './canonical-product-eligibility';
import {
  SourceCategoryMappingGenderSlice,
  SourceCategoryMappingStatus,
} from './entities/source-category-mapping.entity';

export type PdpMappingRuleRow = {
  id: number;
  sourceCategoryId: number;
  canonicalCategoryId: number;
  genderSlice?: string | null;
  reviewStatus?: string | null;
  status?: string | null;
};

function normalizeSlice(
  raw: string | null | undefined,
): SourceCategoryMappingGenderSlice | null {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (!s || s === SourceCategoryMappingGenderSlice.any) {
    return SourceCategoryMappingGenderSlice.any;
  }
  if (s === SourceCategoryMappingGenderSlice.female) {
    return SourceCategoryMappingGenderSlice.female;
  }
  if (s === SourceCategoryMappingGenderSlice.male) {
    return SourceCategoryMappingGenderSlice.male;
  }
  if (s === SourceCategoryMappingGenderSlice.unisex) {
    return SourceCategoryMappingGenderSlice.unisex;
  }
  return null;
}

function normalizeProductGender(
  raw: string | null | undefined,
): ProductGender | null {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === ProductGender.female) return ProductGender.female;
  if (s === ProductGender.male) return ProductGender.male;
  if (s === ProductGender.unisex) return ProductGender.unisex;
  return null;
}

/**
 * Shared "effective active mapping rule" concept aligned with V2-B slice gating.
 * Caller may pre-filter status=active; still fail-closed if status is present and inactive.
 */
export function isEffectivePdpMappingRule(
  row: PdpMappingRuleRow,
  sliceRoutingEnabled: boolean,
): boolean {
  if (
    row.status != null &&
    row.status !== SourceCategoryMappingStatus.active &&
    String(row.status) !== 'active'
  ) {
    return false;
  }
  const slice = normalizeSlice(row.genderSlice);
  if (slice == null) return false;
  if (slice === SourceCategoryMappingGenderSlice.any) return true;
  if (!sliceRoutingEnabled) return false;
  return ROUTABLE_SLICE_REVIEW_STATUSES.has(String(row.reviewStatus || ''));
}

/**
 * Pick one mapping row for a single source category.
 * Stable: among same-slice candidates, lowest id wins (never array order).
 */
export function pickEffectiveMappingForPdpBreadcrumb<
  T extends PdpMappingRuleRow,
>(
  productGender: string | null | undefined,
  rows: T[],
  options?: { sliceRoutingEnabled?: boolean },
): T | null {
  if (!rows?.length) return null;
  const enabled =
    options?.sliceRoutingEnabled ?? isCatalogMappingV2SliceRoutingEnabled();

  const bySlice = new Map<SourceCategoryMappingGenderSlice, T>();
  for (const row of rows) {
    if (!isEffectivePdpMappingRule(row, enabled)) continue;
    const slice = normalizeSlice(row.genderSlice);
    if (slice == null) continue;
    const existing = bySlice.get(slice);
    if (!existing || Number(row.id) < Number(existing.id)) {
      bySlice.set(slice, row);
    }
  }
  if (!bySlice.size) return null;

  const prefer = (
    order: SourceCategoryMappingGenderSlice[],
  ): T | null => {
    for (const slice of order) {
      const hit = bySlice.get(slice);
      if (hit) return hit;
    }
    return null;
  };

  const gender = normalizeProductGender(productGender);
  if (gender === ProductGender.female) {
    return prefer([
      SourceCategoryMappingGenderSlice.female,
      SourceCategoryMappingGenderSlice.any,
    ]);
  }
  if (gender === ProductGender.male) {
    return prefer([
      SourceCategoryMappingGenderSlice.male,
      SourceCategoryMappingGenderSlice.any,
    ]);
  }
  if (gender === ProductGender.unisex) {
    return prefer([
      SourceCategoryMappingGenderSlice.unisex,
      SourceCategoryMappingGenderSlice.any,
    ]);
  }
  return prefer([SourceCategoryMappingGenderSlice.any]);
}

/**
 * Leaf→root ancestor walk: first source level with an effective mapping wins.
 * Opposite-gender slices never enter the candidate set for the product.
 */
export function resolveNearestMappedCanonicalId(
  ancestorIds: number[],
  mappings: PdpMappingRuleRow[],
  productGender: string | null | undefined,
  options?: { sliceRoutingEnabled?: boolean },
): number | null {
  if (!ancestorIds?.length || !mappings?.length) return null;

  const bySource = new Map<number, PdpMappingRuleRow[]>();
  for (const m of mappings) {
    const sid = Number(m.sourceCategoryId);
    if (!Number.isFinite(sid)) continue;
    const list = bySource.get(sid) || [];
    list.push(m);
    bySource.set(sid, list);
  }

  for (const id of ancestorIds) {
    const rows = bySource.get(Number(id));
    if (!rows?.length) continue;
    const picked = pickEffectiveMappingForPdpBreadcrumb(
      productGender,
      rows,
      options,
    );
    if (picked) {
      const cid = Number(picked.canonicalCategoryId);
      if (Number.isFinite(cid) && cid > 0) return cid;
    }
  }
  return null;
}

/**
 * Pre-PRE-E defect for shadow comparison only:
 * Map(sourceCategoryId → canonicalCategoryId) last-write-wins across slices.
 */
export function resolveNearestMappedCanonicalIdLegacyLastWriteWins(
  ancestorIds: number[],
  mappings: Array<{
    sourceCategoryId: number;
    canonicalCategoryId: number;
  }>,
): number | null {
  if (!ancestorIds?.length || !mappings?.length) return null;
  const mappingBySource = new Map(
    mappings.map((m) => [m.sourceCategoryId, m.canonicalCategoryId]),
  );
  for (const id of ancestorIds) {
    const hit = mappingBySource.get(id);
    if (hit) return hit;
  }
  return null;
}
