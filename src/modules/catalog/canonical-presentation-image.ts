/**
 * Batched presentation-image resolution for canonical storefront navigation.
 * Read-only. Does not mutate Product / Category / mapping rows.
 *
 * Priority per canonical node:
 * 1) explicit canonical.imagePath
 * 2) mapped source category icon / product cover (incl. source descendants)
 * 3) mapped descendant canonical → source image
 * 4) null → storefront local fallback
 *
 * Deterministic ordering (never rely on DB row order):
 * - Mappings for one canonical: source ASC, sourceCategoryId ASC, mapping id ASC
 * - Source descendants: displayOrder ASC, id ASC, name ASC
 * - Product covers: categoryId ASC, pathFile ASC (first wins)
 */

export type CanonicalImageRow = {
  id: number;
  parentId: number | null;
  imagePath?: string | null;
  displayOrder?: number;
};

export type SourceMappingRow = {
  canonicalCategoryId: number;
  sourceCategoryId: number;
  /** Denormalized retailer key — used only for stable ordering. */
  source?: string | null;
  /** Mapping row id — final tie-breaker. */
  id?: number | null;
};

export type SourceTaxonomyRow = {
  id: number;
  parentId: number | null;
  iconPath: string | null;
  displayOrder?: number | null;
  name?: string | null;
};

export type ProductCoverRow = {
  categoryId: number;
  pathFile: string;
};

function compareByDisplayOrderIdName(
  a: { id: number; displayOrder?: number | null; name?: string | null },
  b: { id: number; displayOrder?: number | null; name?: string | null },
): number {
  const orderA = a.displayOrder ?? 0;
  const orderB = b.displayOrder ?? 0;
  if (orderA !== orderB) return orderA - orderB;
  if (a.id !== b.id) return a.id - b.id;
  return String(a.name || '').localeCompare(String(b.name || ''), 'fa');
}

function compareMappings(a: SourceMappingRow, b: SourceMappingRow): number {
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

function compareCanonical(a: CanonicalImageRow, b: CanonicalImageRow): number {
  return compareByDisplayOrderIdName(a, b);
}

/** Collect sourceCategoryId + descendants with deterministic child order. */
export function collectSourceSubtreeIds(
  rootId: number,
  childrenByParent: Map<number | null, number[]>,
  maxNodes = 500,
): number[] {
  const result: number[] = [];
  const queue = [rootId];
  const seen = new Set<number>();

  while (queue.length && result.length < maxNodes) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    const children = childrenByParent.get(id) || [];
    for (const childId of children) {
      if (!seen.has(childId)) queue.push(childId);
    }
  }

  return result;
}

/**
 * Build parent→children adjacency with children sorted by
 * displayOrder, id, name (stable, independent of input order).
 */
export function buildSourceChildrenMap(
  taxonomy: SourceTaxonomyRow[],
): Map<number | null, number[]> {
  const byParent = new Map<number | null, SourceTaxonomyRow[]>();
  for (const row of taxonomy) {
    const key = row.parentId == null ? null : Number(row.parentId);
    const list = byParent.get(key) || [];
    list.push(row);
    byParent.set(key, list);
  }

  const childrenByParent = new Map<number | null, number[]>();
  for (const [key, list] of byParent) {
    list.sort(compareByDisplayOrderIdName);
    childrenByParent.set(
      key,
      list.map((row) => row.id),
    );
  }
  return childrenByParent;
}

/** Sort mappings into the documented deterministic order. */
export function sortSourceMappings(
  mappings: SourceMappingRow[],
): SourceMappingRow[] {
  return [...mappings].sort(compareMappings);
}

/**
 * Resolve a single image path for every canonical id.
 * Pure / deterministic. Fixed query count on the service side.
 */
export function resolveCanonicalPresentationImages(
  canonicals: CanonicalImageRow[],
  mappings: SourceMappingRow[],
  sourceTaxonomy: SourceTaxonomyRow[],
  productCovers: ProductCoverRow[],
): Map<number, string | null> {
  const byId = new Map(canonicals.map((c) => [c.id, c]));
  const childrenByParent = new Map<number | null, CanonicalImageRow[]>();

  for (const row of canonicals) {
    const key = row.parentId == null ? null : Number(row.parentId);
    const list = childrenByParent.get(key) || [];
    list.push(row);
    childrenByParent.set(key, list);
  }
  for (const [, list] of childrenByParent) {
    list.sort(compareCanonical);
  }

  const mappingsByCanonical = new Map<number, SourceMappingRow[]>();
  for (const mapping of sortSourceMappings(mappings)) {
    const list = mappingsByCanonical.get(mapping.canonicalCategoryId) || [];
    list.push(mapping);
    mappingsByCanonical.set(mapping.canonicalCategoryId, list);
  }
  for (const [, list] of mappingsByCanonical) {
    list.sort(compareMappings);
  }

  const sourceById = new Map(sourceTaxonomy.map((s) => [s.id, s]));
  const sourceChildren = buildSourceChildrenMap(sourceTaxonomy);

  const sortedCovers = [...productCovers].sort((a, b) => {
    if (a.categoryId !== b.categoryId) return a.categoryId - b.categoryId;
    return String(a.pathFile).localeCompare(String(b.pathFile), 'en');
  });

  const coverBySource = new Map<number, string>();
  for (const row of sortedCovers) {
    if (!coverBySource.has(row.categoryId) && row.pathFile) {
      coverBySource.set(Number(row.categoryId), row.pathFile);
    }
  }

  const imageFromSourceRoot = (sourceCategoryId: number): string | null => {
    const subtree = collectSourceSubtreeIds(sourceCategoryId, sourceChildren);
    for (const id of subtree) {
      const icon = sourceById.get(id)?.iconPath;
      if (icon) return icon;
      const cover = coverBySource.get(id);
      if (cover) return cover;
    }
    return null;
  };

  const imageFromCanonicalMappings = (canonicalId: number): string | null => {
    const rows = mappingsByCanonical.get(canonicalId) || [];
    for (const mapping of rows) {
      const found = imageFromSourceRoot(mapping.sourceCategoryId);
      if (found) return found;
    }
    return null;
  };

  const memo = new Map<number, string | null>();

  const resolve = (
    canonicalId: number,
    ancestors: Set<number>,
  ): string | null => {
    if (memo.has(canonicalId)) {
      return memo.get(canonicalId) ?? null;
    }
    if (ancestors.has(canonicalId)) {
      return null;
    }

    const row = byId.get(canonicalId);
    if (!row) {
      memo.set(canonicalId, null);
      return null;
    }

    if (row.imagePath) {
      memo.set(canonicalId, row.imagePath);
      return row.imagePath;
    }

    const directMapped = imageFromCanonicalMappings(canonicalId);
    if (directMapped) {
      memo.set(canonicalId, directMapped);
      return directMapped;
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(canonicalId);
    const children = childrenByParent.get(canonicalId) || [];
    for (const child of children) {
      const found = resolve(child.id, nextAncestors);
      if (found) {
        memo.set(canonicalId, found);
        return found;
      }
    }

    memo.set(canonicalId, null);
    return null;
  };

  const result = new Map<number, string | null>();
  const sortedCanonicals = [...canonicals].sort(compareCanonical);
  for (const row of sortedCanonicals) {
    result.set(row.id, resolve(row.id, new Set()));
  }
  return result;
}

/** Apply resolved images onto flat canonical inputs before tree build. */
export function applyResolvedImages(
  rows: Array<{
    id: number;
    parentId: number | null;
    name: string;
    imagePath?: string | null;
    displayOrder?: number;
  }>,
  imageById: Map<number, string | null>,
): Array<{
  id: number;
  parentId: number | null;
  name: string;
  imagePath: string | null;
  displayOrder?: number;
}> {
  return rows.map((row) => ({
    ...row,
    imagePath: imageById.get(row.id) ?? row.imagePath ?? null,
  }));
}
