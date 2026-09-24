/**
 * Batched presentation-image resolution for canonical storefront navigation.
 * Read-only. Does not mutate Product / Category / mapping rows.
 *
 * Priority per canonical node:
 * 1) explicit canonical.discoveryImagePath (CAT-2 merchandising)
 * 2) explicit canonical.imagePath
 * 3) mapped source category icon / product cover (incl. source descendants),
 *    filtered by canonical audience context (women / men / kids)
 * 4) name-matched source category (exact → normalized → "label و …"),
 *    preferring same-root mapped sources, then audience-compatible neutrals.
 *    Never pick an obviously gender/age-incompatible source just because
 *    the leaf label matches.
 * 5) mapped descendant canonical → source image (same filters)
 * 6) null → storefront local fallback
 *
 * Deterministic ordering (never rely on DB row order):
 * - Mappings for one canonical: source ASC, sourceCategoryId ASC, mapping id ASC
 * - Source descendants: displayOrder ASC, id ASC, name ASC
 * - Product covers: categoryId ASC, pathFile ASC (first wins)
 * - Name matches: same-root mapped first, then id ASC
 */

export type CanonicalImageRow = {
  id: number;
  parentId: number | null;
  name?: string | null;
  imagePath?: string | null;
  /** CAT-2 discovery merchandising image — preferred when set. */
  discoveryImagePath?: string | null;
  /** Optional Admin audience hint — overrides name inference when set. */
  audience?: string | null;
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

/** Presentation audience derived from canonical root / audience field. */
export type AudienceContext = 'women' | 'men' | 'kids' | 'neutral';

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

/**
 * Collapse Persian retail labels so "کت و مانتو" ≈ "کت مانتو".
 * Presentation-only — does not alter taxonomy identity.
 */
export function normalizeCategoryLabel(name: string): string {
  return String(name || '')
    .replace(/[\u200c\u200f\u202a-\u202e]/g, '')
    .replace(/\s+/g, '')
    .replace(/و/g, '')
    .trim();
}

const AUDIENCE_FIELD_MAP: Record<string, AudienceContext> = {
  women: 'women',
  woman: 'women',
  female: 'women',
  زنانه: 'women',
  men: 'men',
  man: 'men',
  male: 'men',
  مردانه: 'men',
  kids: 'kids',
  kid: 'kids',
  children: 'kids',
  child: 'kids',
  بچگانه: 'kids',
  کودک: 'kids',
};

/**
 * Infer audience from a canonical root / audience label.
 * Unknown labels stay neutral (electronics, beauty, …).
 */
export function inferAudienceContext(
  nameOrAudience: string | null | undefined,
): AudienceContext {
  const raw = String(nameOrAudience || '').trim();
  if (!raw) return 'neutral';
  const key = raw.toLowerCase();
  if (AUDIENCE_FIELD_MAP[key]) return AUDIENCE_FIELD_MAP[key];
  if (AUDIENCE_FIELD_MAP[raw]) return AUDIENCE_FIELD_MAP[raw];
  return 'neutral';
}

/**
 * Source-node exclusivity hint from retail label (presentation only).
 * Used to reject obviously wrong-gender / wrong-age imagery.
 */
export function inferSourceExclusivity(
  sourceName: string | null | undefined,
): AudienceContext {
  const name = String(sourceName || '');
  if (!name) return 'neutral';

  // Women-exclusive retail labels (heels, skirts, hijab outerwear, …)
  if (
    /پاشنه\s*بلند|دامن|بلوز|مجلسی|مانتو|حجاب|سوتین|تونیک|لباس\s*خواب|کفش\s*پاشنه/i.test(
      name,
    )
  ) {
    return 'women';
  }

  // Kids / infant exclusive
  if (/نوزاد|کودک|بچگانه|بچه\s|ست\s*دو\s*تیکه|مادر و نوزاد/i.test(name)) {
    return 'kids';
  }

  return 'neutral';
}

/** True when a source node may contribute imagery for this audience. */
export function isSourceCompatibleWithAudience(
  sourceName: string | null | undefined,
  audience: AudienceContext,
): boolean {
  if (audience === 'neutral') return true;
  const exclusivity = inferSourceExclusivity(sourceName);
  if (exclusivity === 'neutral') return true;
  return exclusivity === audience;
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

  const audienceByCanonical = new Map<number, AudienceContext>();
  const resolveAudience = (canonicalId: number): AudienceContext => {
    if (audienceByCanonical.has(canonicalId)) {
      return audienceByCanonical.get(canonicalId)!;
    }
    const row = byId.get(canonicalId);
    if (!row) {
      audienceByCanonical.set(canonicalId, 'neutral');
      return 'neutral';
    }
    if (row.audience) {
      const fromField = inferAudienceContext(row.audience);
      if (fromField !== 'neutral') {
        audienceByCanonical.set(canonicalId, fromField);
        return fromField;
      }
    }
    if (row.parentId == null) {
      const fromRoot = inferAudienceContext(row.name);
      audienceByCanonical.set(canonicalId, fromRoot);
      return fromRoot;
    }
    const inherited = resolveAudience(row.parentId);
    audienceByCanonical.set(canonicalId, inherited);
    return inherited;
  };

  for (const row of canonicals) {
    resolveAudience(row.id);
  }

  /** Audience root id sets for "same-root mapped source" preference. */
  const canonicalIdsByAudience = new Map<AudienceContext, Set<number>>();
  for (const row of canonicals) {
    const audience = resolveAudience(row.id);
    const set = canonicalIdsByAudience.get(audience) || new Set<number>();
    set.add(row.id);
    canonicalIdsByAudience.set(audience, set);
  }

  const sourcesMappedToAudience = new Map<AudienceContext, Set<number>>();
  for (const audience of ['women', 'men', 'kids', 'neutral'] as AudienceContext[]) {
    sourcesMappedToAudience.set(audience, new Set());
  }
  for (const mapping of mappings) {
    const audience = resolveAudience(mapping.canonicalCategoryId);
    sourcesMappedToAudience.get(audience)?.add(mapping.sourceCategoryId);
  }

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

  const imageFromSourceRoot = (
    sourceCategoryId: number,
    audience: AudienceContext,
  ): string | null => {
    const subtree = collectSourceSubtreeIds(sourceCategoryId, sourceChildren);
    for (const id of subtree) {
      const node = sourceById.get(id);
      if (!isSourceCompatibleWithAudience(node?.name, audience)) {
        continue;
      }
      const icon = node?.iconPath;
      if (icon) return icon;
      const cover = coverBySource.get(id);
      if (cover) return cover;
    }
    return null;
  };

  const imageFromCanonicalMappings = (
    canonicalId: number,
    audience: AudienceContext,
  ): string | null => {
    const rows = mappingsByCanonical.get(canonicalId) || [];
    for (const mapping of rows) {
      const found = imageFromSourceRoot(mapping.sourceCategoryId, audience);
      if (found) return found;
    }
    return null;
  };

  const sourcesByExactName = new Map<string, SourceTaxonomyRow[]>();
  const sourcesByNormalizedName = new Map<string, SourceTaxonomyRow[]>();
  for (const source of [...sourceTaxonomy].sort((a, b) => a.id - b.id)) {
    const label = String(source.name || '').trim();
    if (!label) continue;
    const exactList = sourcesByExactName.get(label) || [];
    exactList.push(source);
    sourcesByExactName.set(label, exactList);
    const normalized = normalizeCategoryLabel(label);
    if (!normalized) continue;
    const normList = sourcesByNormalizedName.get(normalized) || [];
    normList.push(source);
    sourcesByNormalizedName.set(normalized, normList);
  }

  const collectNameMatchCandidates = (
    canonicalName: string,
  ): SourceTaxonomyRow[] => {
    const label = canonicalName.trim();
    const out: SourceTaxonomyRow[] = [];
    const tried = new Set<number>();
    for (const source of sourcesByExactName.get(label) || []) {
      tried.add(source.id);
      out.push(source);
    }
    const normalized = normalizeCategoryLabel(label);
    if (normalized) {
      for (const source of sourcesByNormalizedName.get(normalized) || []) {
        if (tried.has(source.id)) continue;
        tried.add(source.id);
        out.push(source);
      }
    }
    const andPrefix = `${label} و`;
    for (const source of sourceTaxonomy) {
      if (tried.has(source.id)) continue;
      const sourceName = String(source.name || '').trim();
      if (!sourceName.startsWith(andPrefix)) continue;
      tried.add(source.id);
      out.push(source);
    }
    return out;
  };

  /**
   * Name-matched imagery when UNIQUE(sourceCategoryId) left a parallel leaf
   * unmapped. Prefers same-audience mapped sources; never gender-incompatible.
   */
  const imageFromNameMatchedSource = (
    canonicalName: string | null | undefined,
    audience: AudienceContext,
  ): string | null => {
    const label = String(canonicalName || '').trim();
    if (!label) return null;

    const candidates = collectNameMatchCandidates(label).filter((source) =>
      isSourceCompatibleWithAudience(source.name, audience),
    );
    if (!candidates.length) return null;

    const sameRootMapped = sourcesMappedToAudience.get(audience) || new Set();
    const preferred = candidates.filter((s) => sameRootMapped.has(s.id));
    const fallback = candidates.filter((s) => !sameRootMapped.has(s.id));

    // Same-root mapped first; then other compatible neutrals (shared trees).
    for (const pool of [preferred, fallback]) {
      const sorted = [...pool].sort((a, b) => a.id - b.id);
      for (const source of sorted) {
        const found = imageFromSourceRoot(source.id, audience);
        if (found) return found;
      }
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

    if (row.discoveryImagePath) {
      memo.set(canonicalId, row.discoveryImagePath);
      return row.discoveryImagePath;
    }

    if (row.imagePath) {
      memo.set(canonicalId, row.imagePath);
      return row.imagePath;
    }

    const audience = resolveAudience(canonicalId);

    const directMapped = imageFromCanonicalMappings(canonicalId, audience);
    if (directMapped) {
      memo.set(canonicalId, directMapped);
      return directMapped;
    }

    const nameMatched = imageFromNameMatchedSource(row.name, audience);
    if (nameMatched) {
      memo.set(canonicalId, nameMatched);
      return nameMatched;
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
