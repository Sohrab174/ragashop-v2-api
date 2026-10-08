/**
 * CAT-MAP-V2-C — source path + product gender distribution helpers.
 *
 * Scope = selected source category + same-provider descendants
 * (expandSourceCategoryIds / V2-B semantics). Cross-provider links never expand.
 */

import { expandSourceCategoryIds } from './canonical-category-scope.resolver';
import {
  emptyDistribution,
  GenderDistribution,
} from './cat-map-v2a-classification';

export type SourceTaxonomyPathRow = {
  id: number;
  parentId: number | null;
  source?: string | null;
  sourceName?: string | null;
  name?: string | null;
  status?: string;
};

/**
 * Source taxonomy path using sourceName when present (provider truth),
 * falling back to display name. Walk stops at cross-source / null source parents.
 */
export function buildSourceCategoryPath(
  sourceCategoryId: number,
  taxonomy: SourceTaxonomyPathRow[],
  requiredSource?: string | null,
): string[] {
  const byId = new Map(taxonomy.map((r) => [Number(r.id), r]));
  const start = byId.get(Number(sourceCategoryId));
  if (!start) return [];

  const sourceKey =
    requiredSource != null && String(requiredSource).trim()
      ? String(requiredSource).trim()
      : start.source != null && String(start.source).trim()
      ? String(start.source).trim()
      : null;

  const path: string[] = [];
  let cur: SourceTaxonomyPathRow | undefined = start;
  const seen = new Set<number>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const label =
      (cur.sourceName && String(cur.sourceName).trim()) ||
      (cur.name && String(cur.name).trim()) ||
      String(cur.id);
    path.unshift(label);
    if (cur.parentId == null) break;
    const parent = byId.get(Number(cur.parentId));
    if (!parent) break;
    if (sourceKey) {
      const parentSource =
        parent.source != null ? String(parent.source).trim() : '';
      if (!parentSource || parentSource !== sourceKey) break;
    }
    cur = parent;
  }
  return path;
}

export function expandSourceCategoryScopeIds(
  sourceCategoryId: number,
  source: string | null | undefined,
  taxonomy: SourceTaxonomyPathRow[],
): number[] {
  return expandSourceCategoryIds(
    [{ sourceCategoryId: Number(sourceCategoryId), source }],
    taxonomy,
  );
}

export function distributionFromGenderRows(
  rows: Array<{ gender: string | null | undefined; count: number | string }>,
): GenderDistribution {
  const dist = emptyDistribution();
  for (const row of rows) {
    const n = Number(row.count) || 0;
    if (n <= 0) continue;
    const g = row.gender ?? null;
    dist.total += n;
    if (g === 'female') dist.female += n;
    else if (g === 'male') dist.male += n;
    else if (g === 'unisex') dist.unisex += n;
    else dist.unknown += n;
  }
  return dist;
}

/** Merge two distributions (no double-count — caller must use disjoint sets). */
export function addDistributions(
  a: GenderDistribution,
  b: GenderDistribution,
): GenderDistribution {
  return {
    total: a.total + b.total,
    female: a.female + b.female,
    male: a.male + b.male,
    unisex: a.unisex + b.unisex,
    unknown: a.unknown + b.unknown,
  };
}
