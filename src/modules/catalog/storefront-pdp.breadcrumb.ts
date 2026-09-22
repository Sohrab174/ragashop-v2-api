/**
 * Resolve a short customer-facing canonical breadcrumb for a product's
 * source categoryId via active source→canonical mapping.
 *
 * Returns [] when the product's source category is unmapped — caller omits
 * taxonomy rather than guessing from product name.
 */

import type { StorefrontPdpBreadcrumbItem } from './storefront-pdp.types';

export type CanonicalBreadcrumbRow = {
  id: number;
  parentId: number | null;
  name: string;
  status: string;
};

/**
 * Walk parent chain from leaf → root, then reverse to root → leaf.
 * Caps depth to avoid pathological loops; only active nodes included.
 */
export function buildCanonicalBreadcrumbTrail(
  leafId: number | null | undefined,
  byId: Map<number, CanonicalBreadcrumbRow>,
  maxDepth = 8,
): StorefrontPdpBreadcrumbItem[] {
  if (leafId == null || !Number.isFinite(leafId) || leafId <= 0) return [];

  const chain: StorefrontPdpBreadcrumbItem[] = [];
  let current: number | null = leafId;
  const seen = new Set<number>();

  while (current != null && chain.length < maxDepth) {
    if (seen.has(current)) break;
    seen.add(current);
    const row = byId.get(current);
    if (!row || row.status !== 'active') break;
    chain.push({ id: row.id, name: row.name });
    current = row.parentId != null ? Number(row.parentId) : null;
  }

  return chain.reverse();
}

/**
 * Prefer a compact trail (max 3 segments) for PDP chrome.
 * Keep leaf + nearest ancestors — drop deep roots when too long.
 */
export function compactBreadcrumbTrail(
  trail: StorefrontPdpBreadcrumbItem[],
  maxItems = 3,
): StorefrontPdpBreadcrumbItem[] {
  if (trail.length <= maxItems) return trail;
  return trail.slice(trail.length - maxItems);
}
