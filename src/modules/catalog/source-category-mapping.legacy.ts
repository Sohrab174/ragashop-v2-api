import {
  SourceCategoryMappingGenderSlice,
  SourceCategoryMappingReviewStatus,
} from './entities/source-category-mapping.entity';

/**
 * CAT-MAP-V2-A — legacy (V1) Admin mapping write contract.
 *
 * Until CAT-MAP-V2-C/D, all employee saves through the existing upsert path
 * must create/update only genderSlice=any and remain legacy_unreviewed.
 */
export const LEGACY_MAPPING_GENDER_SLICE =
  SourceCategoryMappingGenderSlice.any;

export const LEGACY_MAPPING_REVIEW_STATUS =
  SourceCategoryMappingReviewStatus.legacy_unreviewed;

export type MappingRowForLegacyLookup = {
  id: number;
  sourceCategoryId: number;
  genderSlice?: string | null;
  status?: string | null;
};

/**
 * Prefer the V1 `any` slice when multiple rows exist for one source category.
 * Stable: lowest id wins among matching candidates.
 */
export function selectLegacyMappingForSourceCategory<
  T extends MappingRowForLegacyLookup,
>(rows: T[], sourceCategoryId: number): T | undefined {
  const sid = Number(sourceCategoryId);
  const forSource = rows.filter((r) => Number(r.sourceCategoryId) === sid);
  if (!forSource.length) return undefined;

  const anyRows = forSource.filter(
    (r) =>
      !r.genderSlice ||
      r.genderSlice === SourceCategoryMappingGenderSlice.any,
  );
  const pool = anyRows.length ? anyRows : forSource;
  return [...pool].sort((a, b) => a.id - b.id)[0];
}

/** Build sourceCategoryId → legacy mapping map for Admin board / V1 consumers. */
export function indexLegacyMappingsBySourceCategoryId<
  T extends MappingRowForLegacyLookup,
>(rows: T[]): Map<number, T> {
  const map = new Map<number, T>();
  const bySource = new Map<number, T[]>();
  for (const row of rows) {
    const sid = Number(row.sourceCategoryId);
    const list = bySource.get(sid) || [];
    list.push(row);
    bySource.set(sid, list);
  }
  for (const [sid, list] of bySource) {
    const selected = selectLegacyMappingForSourceCategory(list, sid);
    if (selected) map.set(sid, selected);
  }
  return map;
}
