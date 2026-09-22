/**
 * PDP source-boundary helpers — keep Product taxonomy/siblings inside one
 * authoritative retailer source (no cross-source parent or group leakage).
 */

export function normalizePdpSourceKey(
  source: string | null | undefined,
): string | null {
  const key = String(source ?? '')
    .trim()
    .toLowerCase();
  return key ? key : null;
}

export type SourceCategoryAncestorRow = {
  id: number;
  parentId: number | null;
  source?: string | null;
};

/**
 * Walk leaf → root, returning ids nearest-first.
 * - Start category is always included (when valid).
 * - Each subsequent parent must share `requiredSource`.
 * - Null/empty requiredSource → stop after the start (no parent walk).
 * - Null/empty or mismatched parent source → stop (do not include that parent).
 */
export function collectSameSourceAncestorIds(
  startId: number,
  byId: Map<number, SourceCategoryAncestorRow>,
  requiredSource: string | null,
  maxDepth = 12,
): number[] {
  if (!Number.isFinite(startId) || startId <= 1) return [];

  const ids: number[] = [];
  let current: number | null = startId;
  const seen = new Set<number>();

  while (current != null && current > 1 && ids.length < maxDepth) {
    if (seen.has(current)) break;
    const row = byId.get(current);
    if (!row) break;

    if (ids.length > 0) {
      if (!requiredSource) break;
      if (normalizePdpSourceKey(row.source) !== requiredSource) break;
    }

    seen.add(current);
    ids.push(current);
    current = row.parentId != null ? Number(row.parentId) : null;
  }

  return ids;
}

/**
 * Resolve the source key used for PDP breadcrumb traversal.
 * Prefer Product.source, fall back to the starting category.source.
 */
export function resolvePdpBreadcrumbRequiredSource(
  productSource: string | null | undefined,
  startCategorySource: string | null | undefined,
): string | null {
  return (
    normalizePdpSourceKey(productSource) ??
    normalizePdpSourceKey(startCategorySource)
  );
}

/**
 * Sibling must share non-empty authoritative source with the current Product.
 */
export function siblingSharesAuthoritativeSource(
  currentSource: string | null | undefined,
  candidateSource: string | null | undefined,
): boolean {
  const current = normalizePdpSourceKey(currentSource);
  const candidate = normalizePdpSourceKey(candidateSource);
  return current != null && candidate != null && current === candidate;
}

export type PdpSiblingEligibilityInput = {
  id: number;
  source: string | null | undefined;
  sourceGroupId: string | null | undefined;
  status: string;
  isDeleted: boolean;
  price: number;
  categoryId: number;
};

/**
 * Mirrors PDP sibling query predicates (source + group + visibility).
 * Used for focused regression tests without a DB.
 */
export function isEligiblePdpSiblingCandidate(
  current: PdpSiblingEligibilityInput,
  candidate: PdpSiblingEligibilityInput,
): boolean {
  const group = String(current.sourceGroupId ?? '').trim();
  if (!group) return false;
  if (String(candidate.sourceGroupId ?? '').trim() !== group) return false;
  if (!siblingSharesAuthoritativeSource(current.source, candidate.source)) {
    return false;
  }
  if (candidate.id === current.id) return false;
  if (candidate.status !== 'active') return false;
  if (candidate.isDeleted) return false;
  if (!(candidate.price > 0)) return false;
  if (candidate.categoryId === 1) return false;
  return true;
}
