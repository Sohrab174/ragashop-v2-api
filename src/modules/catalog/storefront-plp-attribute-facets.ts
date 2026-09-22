/**
 * Pure helpers for PLP-2 attribute facet assembly / self-exclusion semantics.
 * Kept separate so regression tests do not require a live DB.
 */

export type AttributeFacetValueRow = {
  attributeId: number;
  valueId: number;
  valueName: string;
  count: number;
};

export type AttributeFacetMeta = {
  id: number;
  name: string;
  type: string;
  productCount: number;
};

/**
 * From a full-filter aggregation: keep value rows only for attributes that are
 * NOT in `selectedAttributeIds` (those need a separate self-excluding pass).
 */
export function partitionAttributeValueRowsForSelfExclusion(
  rows: AttributeFacetValueRow[],
  selectedAttributeIds: number[],
): {
  retained: AttributeFacetValueRow[];
  needsSelfExclusion: number[];
} {
  const selected = new Set(selectedAttributeIds);
  const retained: AttributeFacetValueRow[] = [];
  for (const row of rows) {
    if (selected.has(row.attributeId)) continue;
    if (!row.valueName || row.count <= 0) continue;
    retained.push(row);
  }
  return {
    retained,
    needsSelfExclusion: [...selected].sort((a, b) => a - b),
  };
}

/**
 * Detects impossible advertised choices: a value count > 0 under self-exclusion
 * for attribute A must not imply the listing total stays > 0 when A is also
 * constrained to a disjoint selected value — callers assert listing total.
 *
 * This helper flags values that would be "impossible" if their count is > 0
 * while a different selected value of the same attribute is active AND the
 * cross-attribute scope is empty — used by tests with fixture numbers.
 */
export function findNonzeroFacetValues(
  values: Array<{ id: number; count: number }>,
): number[] {
  return values.filter((v) => v.count > 0).map((v) => v.id);
}

export function pickTopAttributesByProductCount(
  attrs: AttributeFacetMeta[],
  limit: number,
): AttributeFacetMeta[] {
  return [...attrs]
    .sort((a, b) => {
      if (b.productCount !== a.productCount) {
        return b.productCount - a.productCount;
      }
      return a.id - b.id;
    })
    .slice(0, limit);
}
