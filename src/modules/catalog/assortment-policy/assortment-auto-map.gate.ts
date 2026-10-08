/**
 * SCOPE-3/4 — Assortment gate for AUTO-MAP / mapping review / coverage.
 *
 * Pipeline: SOURCE → RESOLUTION →
 *   OUT_OF_SCOPE        → stop (no proposal, not a mapping failure)
 *   REVIEW_REQUIRED     → assortment queue (no mapping proposal)
 *   IN_SCOPE            → AUTO-MAP tiers / mapping review queue
 *
 * Pure functions only. Never mutates mappings.
 */

import { AssortmentPolicyStatus } from './assortment-policy.types';

export type AssortmentGateAction =
  | 'STOP_OUT_OF_SCOPE'
  | 'ASSORTMENT_QUEUE'
  | 'AUTO_MAP_ELIGIBLE';

export type AssortmentGateResult = {
  status: AssortmentPolicyStatus | null;
  action: AssortmentGateAction;
  /** True when AUTO-MAP / mapping-review should process this category. */
  mappingEligible: boolean;
  /** True when the category belongs on the assortment decisions queue. */
  assortmentQueueEligible: boolean;
};

export function resolveAssortmentGate(
  status: string | null | undefined,
): AssortmentGateResult {
  if (status === 'IN_SCOPE') {
    return {
      status: 'IN_SCOPE',
      action: 'AUTO_MAP_ELIGIBLE',
      mappingEligible: true,
      assortmentQueueEligible: false,
    };
  }
  if (status === 'OUT_OF_SCOPE') {
    return {
      status: 'OUT_OF_SCOPE',
      action: 'STOP_OUT_OF_SCOPE',
      mappingEligible: false,
      assortmentQueueEligible: false,
    };
  }
  // Missing resolution fails closed to REVIEW (never OUT).
  return {
    status: status === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : null,
    action: 'ASSORTMENT_QUEUE',
    mappingEligible: false,
    assortmentQueueEligible: true,
  };
}

export function isMappingEligibleStatus(
  status: string | null | undefined,
): boolean {
  return resolveAssortmentGate(status).mappingEligible;
}

function readStatus(
  statusByCategoryId: Map<number, string> | Record<number, string>,
  id: number,
): string | undefined {
  if (statusByCategoryId instanceof Map) return statusByCategoryId.get(id);
  return (statusByCategoryId as Record<number, string>)[id];
}

export function filterMappingEligibleIds(
  categoryIds: number[],
  statusByCategoryId: Map<number, string> | Record<number, string>,
): number[] {
  return categoryIds.filter((id) =>
    isMappingEligibleStatus(readStatus(statusByCategoryId, id)),
  );
}

/**
 * Coverage denominators: only IN_SCOPE discoverable products.
 * OUT / REVIEW are informational, never failures.
 */
export type AssortmentCoverageBucket = {
  categories: number;
  discoverableProducts: number;
};

export type AssortmentAwareCoverage = {
  denominators: {
    inScopeDiscoverableProducts: string;
    inScopeMissingDestination: string;
  };
  products: {
    totalDiscoverable: number;
    inScopeDiscoverable: number;
    reviewDiscoverable: number;
    outDiscoverable: number;
    /** AUTO-MAP HIGH routable within IN_SCOPE (caller supplies). */
    autoMapHighRoutable?: number;
    /** AUTO-MAP HIGH+SUGGEST routable within IN_SCOPE. */
    autoMapHighSuggestRoutable?: number;
    inScopeMissingDestinationProducts: number;
  };
  categories: {
    total: number;
    inScope: number;
    reviewRequired: number;
    outOfScope: number;
    inScopeMissingDestination: number;
  };
  percents: {
    autoMapHighOfInScope?: number | null;
    autoMapHighSuggestOfInScope?: number | null;
  };
};

export function pct(n: number, d: number): number | null {
  if (!d) return null;
  return Math.round((n / d) * 10000) / 100;
}

export function buildAssortmentAwareCoverage(input: {
  totalDiscoverable: number;
  byStatus: Record<string, AssortmentCoverageBucket>;
  inScopeMissingDestination: AssortmentCoverageBucket;
  autoMapHighRoutable?: number;
  autoMapHighSuggestRoutable?: number;
}): AssortmentAwareCoverage {
  const inB = input.byStatus.IN_SCOPE || { categories: 0, discoverableProducts: 0 };
  const revB = input.byStatus.REVIEW_REQUIRED || {
    categories: 0,
    discoverableProducts: 0,
  };
  const outB = input.byStatus.OUT_OF_SCOPE || {
    categories: 0,
    discoverableProducts: 0,
  };
  const inScope = inB.discoverableProducts;
  return {
    denominators: {
      inScopeDiscoverableProducts:
        'Discoverable products whose source category resolves IN_SCOPE under the active assortment policy. OUT/REVIEW are excluded from the coverage denominator.',
      inScopeMissingDestination:
        'IN_SCOPE categories/products with AUTO-MAP tier NO_DESTINATION (canonical tree gap). Not a policy failure.',
    },
    products: {
      totalDiscoverable: input.totalDiscoverable,
      inScopeDiscoverable: inScope,
      reviewDiscoverable: revB.discoverableProducts,
      outDiscoverable: outB.discoverableProducts,
      autoMapHighRoutable: input.autoMapHighRoutable,
      autoMapHighSuggestRoutable: input.autoMapHighSuggestRoutable,
      inScopeMissingDestinationProducts:
        input.inScopeMissingDestination.discoverableProducts,
    },
    categories: {
      total: inB.categories + revB.categories + outB.categories,
      inScope: inB.categories,
      reviewRequired: revB.categories,
      outOfScope: outB.categories,
      inScopeMissingDestination: input.inScopeMissingDestination.categories,
    },
    percents: {
      autoMapHighOfInScope:
        input.autoMapHighRoutable == null
          ? null
          : pct(input.autoMapHighRoutable, inScope),
      autoMapHighSuggestOfInScope:
        input.autoMapHighSuggestRoutable == null
          ? null
          : pct(input.autoMapHighSuggestRoutable, inScope),
    },
  };
}

/** Classify legacy mapping rows by the source category's assortment status. */
export function classifyLegacyMappingsByAssortment(input: {
  mappings: Array<{ id: number; sourceCategoryId: number }>;
  statusByCategoryId: Map<number, string> | Record<number, string>;
}): {
  byStatus: Record<string, { mappingIds: number[]; count: number }>;
  unresolvable: number[];
} {
  const byStatus: Record<string, { mappingIds: number[]; count: number }> = {
    IN_SCOPE: { mappingIds: [], count: 0 },
    REVIEW_REQUIRED: { mappingIds: [], count: 0 },
    OUT_OF_SCOPE: { mappingIds: [], count: 0 },
  };
  const unresolvable: number[] = [];
  for (const m of input.mappings) {
    const st = readStatus(input.statusByCategoryId, Number(m.sourceCategoryId));
    if (!st || !byStatus[st]) {
      unresolvable.push(Number(m.id));
      continue;
    }
    byStatus[st].mappingIds.push(Number(m.id));
    byStatus[st].count++;
  }
  return { byStatus, unresolvable };
}
