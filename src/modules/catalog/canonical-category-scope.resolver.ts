/**
 * Canonical → source category scope for Product Listing (PLP-1).
 *
 * EXPLICIT ACTIVE MAPPINGS ONLY.
 * No name / gender / title heuristics. No cross-audience guessing.
 *
 * Flow:
 *   selected canonical (+ active descendants)
 *     → active source_category_mapping rows
 *     → mapped source categories (+ SAME-SOURCE descendants only)
 *     → product.categoryId filter set
 *
 * NULL SOURCE POLICY (PLP-1):
 * - Mapped root is included when active (explicit mapping wins).
 * - Descendant expansion requires a non-empty authoritative mapping.source.
 * - A descendant is included ONLY when child.source is non-null/non-empty AND
 *   exactly equals that mapping.source.
 * - source-null children NEVER inherit or bridge into a retailer scope.
 * - If mapping.source is null/empty: include the mapped root only (no expansion).
 */

import { CANONICAL_TREE_MAX_DEPTH } from './canonical-tree.builder';

export const CANONICAL_SCOPE_MAX_DEPTH = CANONICAL_TREE_MAX_DEPTH;
export const SOURCE_SUBTREE_MAX_NODES = 500;

export type CanonicalScopeRow = {
  id: number;
  parentId: number | null;
  status: string;
  displayOrder?: number | null;
  name?: string | null;
};

export type SourceMappingScopeRow = {
  id?: number | null;
  canonicalCategoryId: number;
  sourceCategoryId: number;
  status: string;
  /** Authoritative retailer key from mapping (copied from category on write). */
  source?: string | null;
};

export type SourceTaxonomyScopeRow = {
  id: number;
  parentId: number | null;
  /** Retailer identity on the category row — required for same-source expansion. */
  source?: string | null;
  status?: string;
  displayOrder?: number | null;
  name?: string | null;
};

export type CanonicalCategoryScopeResult = {
  selectedCanonicalId: number;
  /** Selected node + active descendants (includes selected when active). */
  canonicalCategoryIds: number[];
  /** Deduped active mapping sourceCategoryId values (roots only). */
  mappedSourceCategoryIds: number[];
  /**
   * Final product filter set: mapped roots + same-source descendants,
   * excluding stub id <= 1, deduped, sorted ascending.
   */
  sourceCategoryIds: number[];
};

function compareCanonicalScope(
  a: CanonicalScopeRow,
  b: CanonicalScopeRow,
): number {
  const orderA = a.displayOrder ?? 0;
  const orderB = b.displayOrder ?? 0;
  if (orderA !== orderB) return orderA - orderB;
  if (a.id !== b.id) return a.id - b.id;
  return String(a.name || '').localeCompare(String(b.name || ''), 'fa');
}

function compareMappings(
  a: SourceMappingScopeRow,
  b: SourceMappingScopeRow,
): number {
  const sourceCmp = String(a.source || '').localeCompare(
    String(b.source || ''),
    'en',
  );
  if (sourceCmp !== 0) return sourceCmp;
  if (a.sourceCategoryId !== b.sourceCategoryId) {
    return a.sourceCategoryId - b.sourceCategoryId;
  }
  return (a.id ?? 0) - (b.id ?? 0);
}

function compareTaxonomyRows(
  a: SourceTaxonomyScopeRow,
  b: SourceTaxonomyScopeRow,
): number {
  const orderA = a.displayOrder ?? 0;
  const orderB = b.displayOrder ?? 0;
  if (orderA !== orderB) return orderA - orderB;
  if (a.id !== b.id) return a.id - b.id;
  return String(a.name || '').localeCompare(String(b.name || ''), 'fa');
}

function normalizeSourceKey(source: string | null | undefined): string | null {
  if (source == null) return null;
  const trimmed = String(source).trim();
  return trimmed.length ? trimmed : null;
}

/**
 * Collect selected canonical id + ACTIVE descendants only.
 * Cycle-safe, depth-bounded, deterministic child order.
 * Inactive descendants are skipped (their subtrees are not entered).
 */
export function collectActiveCanonicalScopeIds(
  selectedId: number,
  rows: CanonicalScopeRow[],
  options?: { maxDepth?: number },
): number[] {
  const maxDepth = options?.maxDepth ?? CANONICAL_SCOPE_MAX_DEPTH;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const selected = byId.get(selectedId);
  if (!selected || selected.status !== 'active') {
    return [];
  }

  const childrenByParent = new Map<number | null, CanonicalScopeRow[]>();
  for (const row of rows) {
    if (row.status !== 'active') continue;
    const key = row.parentId == null ? null : Number(row.parentId);
    const list = childrenByParent.get(key) || [];
    list.push(row);
    childrenByParent.set(key, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort(compareCanonicalScope);
  }

  const result: number[] = [];
  const queue: Array<{ id: number; depth: number }> = [
    { id: selectedId, depth: 0 },
  ];
  const seen = new Set<number>();

  while (queue.length) {
    const { id, depth } = queue.shift()!;
    if (seen.has(id)) continue;
    if (depth > maxDepth) continue;
    seen.add(id);

    const row = byId.get(id);
    if (!row || row.status !== 'active') continue;

    result.push(id);

    const children = childrenByParent.get(id) || [];
    for (const child of children) {
      if (!seen.has(child.id)) {
        queue.push({ id: child.id, depth: depth + 1 });
      }
    }
  }

  return result;
}

/**
 * Active mappings whose canonicalCategoryId is in the given scope.
 * Deterministic order; sourceCategoryIds returned unique ascending.
 */
export function collectActiveMappedSourceIds(
  canonicalCategoryIds: number[],
  mappings: SourceMappingScopeRow[],
): number[] {
  return collectActiveMappingsInScope(canonicalCategoryIds, mappings).map(
    (m) => m.sourceCategoryId,
  );
}

/** Active mappings in canonical scope, deterministic, unique by sourceCategoryId. */
export function collectActiveMappingsInScope(
  canonicalCategoryIds: number[],
  mappings: SourceMappingScopeRow[],
): SourceMappingScopeRow[] {
  if (!canonicalCategoryIds.length) return [];

  const scope = new Set(canonicalCategoryIds);
  const active = mappings
    .filter(
      (m) =>
        m.status === 'active' &&
        scope.has(m.canonicalCategoryId) &&
        Number(m.sourceCategoryId) > 1,
    )
    .sort(compareMappings);

  const result: SourceMappingScopeRow[] = [];
  const seen = new Set<number>();
  for (const m of active) {
    const id = Number(m.sourceCategoryId);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(m);
  }
  return result;
}

/**
 * Build parent→children adjacency for ONE authoritative source only.
 * Excludes inactive and source-null rows; excludes other retailers.
 */
export function buildSameSourceChildrenMap(
  taxonomy: SourceTaxonomyScopeRow[],
  requiredSource: string,
): Map<number, number[]> {
  const byParent = new Map<number, SourceTaxonomyScopeRow[]>();

  for (const row of taxonomy) {
    if (row.status != null && row.status !== 'active') continue;
    if (row.id <= 1) continue;
    if (normalizeSourceKey(row.source) !== requiredSource) continue;
    if (row.parentId == null) continue;

    const parentId = Number(row.parentId);
    const list = byParent.get(parentId) || [];
    list.push(row);
    byParent.set(parentId, list);
  }

  const childrenByParent = new Map<number, number[]>();
  for (const [parentId, list] of byParent) {
    list.sort(compareTaxonomyRows);
    childrenByParent.set(
      parentId,
      list.map((row) => row.id),
    );
  }
  return childrenByParent;
}

/**
 * Expand mapped roots with same-source descendants only.
 * Cross-source parentId links are ignored during traversal.
 */
export function expandSourceCategoryIds(
  mappings: Array<Pick<SourceMappingScopeRow, 'sourceCategoryId' | 'source'>>,
  taxonomy: SourceTaxonomyScopeRow[],
  options?: { maxNodesPerRoot?: number },
): number[] {
  if (!mappings.length) return [];

  const maxNodes = options?.maxNodesPerRoot ?? SOURCE_SUBTREE_MAX_NODES;
  const byId = new Map(taxonomy.map((row) => [row.id, row]));
  const result: number[] = [];
  const seen = new Set<number>();

  const ordered = [...mappings].sort((a, b) => {
    const sourceCmp = String(a.source || '').localeCompare(
      String(b.source || ''),
      'en',
    );
    if (sourceCmp !== 0) return sourceCmp;
    return a.sourceCategoryId - b.sourceCategoryId;
  });

  for (const mapping of ordered) {
    const rootId = Number(mapping.sourceCategoryId);
    if (rootId <= 1 || seen.has(rootId)) continue;

    const root = byId.get(rootId);
    if (!root) continue;
    if (root.status != null && root.status !== 'active') continue;

    seen.add(rootId);
    result.push(rootId);

    const requiredSource = normalizeSourceKey(mapping.source);
    // Null/empty mapping.source → root only (no unsafe expansion).
    if (!requiredSource) continue;

    const childrenByParent = buildSameSourceChildrenMap(
      taxonomy,
      requiredSource,
    );

    const queue = [rootId];
    let visitedInSubtree = 1;

    while (queue.length && visitedInSubtree < maxNodes) {
      const parentId = queue.shift()!;
      const childIds = childrenByParent.get(parentId) || [];
      for (const childId of childIds) {
        if (seen.has(childId)) continue;
        if (visitedInSubtree >= maxNodes) break;
        seen.add(childId);
        result.push(childId);
        queue.push(childId);
        visitedInSubtree += 1;
      }
    }
  }

  return result.sort((a, b) => a - b);
}

/**
 * Pure canonical listing scope resolver.
 * Returns empty sourceCategoryIds when unmapped — caller must return empty PLP.
 */
export function resolveCanonicalCategoryScope(
  selectedCanonicalId: number,
  canonicalRows: CanonicalScopeRow[],
  mappings: SourceMappingScopeRow[],
  sourceTaxonomy: SourceTaxonomyScopeRow[],
  options?: {
    maxCanonicalDepth?: number;
    maxSourceNodesPerRoot?: number;
  },
): CanonicalCategoryScopeResult {
  const canonicalCategoryIds = collectActiveCanonicalScopeIds(
    selectedCanonicalId,
    canonicalRows,
    { maxDepth: options?.maxCanonicalDepth },
  );

  const activeMappings = collectActiveMappingsInScope(
    canonicalCategoryIds,
    mappings,
  );

  const mappedSourceCategoryIds = activeMappings
    .map((m) => m.sourceCategoryId)
    .sort((a, b) => a - b);

  const sourceCategoryIds = expandSourceCategoryIds(
    activeMappings,
    sourceTaxonomy,
    { maxNodesPerRoot: options?.maxSourceNodesPerRoot },
  );

  return {
    selectedCanonicalId,
    canonicalCategoryIds,
    mappedSourceCategoryIds,
    sourceCategoryIds,
  };
}
