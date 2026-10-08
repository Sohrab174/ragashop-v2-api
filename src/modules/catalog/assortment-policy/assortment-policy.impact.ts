/**
 * SCOPE-3/4 — pure impact / high-risk helpers for assortment preview+apply.
 */

import { resolveHighImpactThreshold } from '../cat-map-v2c-write.validation';
import {
  AssortmentPolicyDecision,
  AssortmentPolicyStatus,
} from './assortment-policy.types';
import {
  isSameResolution,
  PersistedResolutionLike,
} from './assortment-policy.recompute-plan';

export class AssortmentPolicyAdminValidationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid_category'
      | 'invalid_status'
      | 'confirm_required'
      | 'permission'
      | 'noop' = 'invalid_status',
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AssortmentPolicyAdminValidationError';
  }
}

export type AssortmentStatusChange = {
  categoryId: number;
  fromStatus: string | null;
  toStatus: string;
  fromReasonCode: string | null;
  toReasonCode: string;
  fromVia: string | null;
  toVia: string;
  liveProducts: number;
  discoverableProducts: number;
};

export type AssortmentImpactSummary = {
  impactedCategoryCount: number;
  impactedLiveProductCount: number;
  impactedDiscoverableProductCount: number;
  existingMappingCount: number;
  existingOrderItemCount: number;
  changes: AssortmentStatusChange[];
  /** Categories where a valid/active mapping would become excluded from the mapping queue. */
  mappingsExcludedFromQueueCount: number;
  /** IN products that would move to OUT or REVIEW. */
  inProductsLeavingScope: number;
  confirmationRequired: boolean;
  highRiskReasons: string[];
  /** Informational only — SCOPE-5/6 may enforce later. */
  scopeExpansionHints: string[];
  /** SCOPE-5/6 — operational consequences once enforcement flags are ON. */
  operational: AssortmentOperationalImpact;
};

export type AssortmentOperationalImpact = {
  /** Discoverable products that would disappear from PLP/Search/nav. */
  productsBecomingHidden: number;
  /** Live products that would lose Cart/Buy Now/Checkout eligibility. */
  productsLosingPurchase: number;
  /** Live products that would drop out of crawler refresh windows. */
  refreshCandidatesStopped: number;
  /** Live products in categories moving to IN (reactivation candidates). */
  productsPotentiallyReactivated: number;
  /** Categories moving from non-IN to IN. */
  categoriesReactivated: number;
};

export function computeAssortmentOperationalImpact(
  changes: AssortmentStatusChange[],
): AssortmentOperationalImpact {
  let hidden = 0;
  let losingPurchase = 0;
  let refreshStopped = 0;
  let reactivated = 0;
  let categoriesReactivated = 0;
  for (const c of changes) {
    const wasIn = c.fromStatus === 'IN_SCOPE';
    const willBeIn = c.toStatus === 'IN_SCOPE';
    if (wasIn && !willBeIn) {
      hidden += c.discoverableProducts;
      losingPurchase += c.liveProducts;
      refreshStopped += c.liveProducts;
    } else if (!wasIn && willBeIn) {
      reactivated += c.liveProducts;
      categoriesReactivated += 1;
    }
  }
  return {
    productsBecomingHidden: hidden,
    productsLosingPurchase: losingPurchase,
    refreshCandidatesStopped: refreshStopped,
    productsPotentiallyReactivated: reactivated,
    categoriesReactivated,
  };
}

export function diffAssortmentDecisions(input: {
  previous: PersistedResolutionLike[];
  proposed: AssortmentPolicyDecision[];
  liveByCategoryId?: Record<number, number>;
  discoverableByCategoryId?: Record<number, number>;
}): AssortmentStatusChange[] {
  const prevById = new Map(
    input.previous.map((r) => [Number(r.categoryId), r]),
  );
  const live = input.liveByCategoryId || {};
  const disc = input.discoverableByCategoryId || {};
  const changes: AssortmentStatusChange[] = [];
  for (const d of input.proposed) {
    const prev = prevById.get(d.categoryId);
    if (
      prev &&
      isSameResolution(prev, {
        categoryId: d.categoryId,
        status: d.status,
        reasonCode: d.reasonCode,
        ruleId: d.ruleId,
        via: d.via,
        businessDomain: d.businessDomain,
      })
    ) {
      continue;
    }
    changes.push({
      categoryId: d.categoryId,
      fromStatus: prev?.status ?? null,
      toStatus: d.status,
      fromReasonCode: prev?.reasonCode ?? null,
      toReasonCode: d.reasonCode,
      fromVia: prev?.via ?? null,
      toVia: d.via,
      liveProducts: Number(live[d.categoryId] || 0),
      discoverableProducts: Number(disc[d.categoryId] || 0),
    });
  }
  changes.sort((a, b) => a.categoryId - b.categoryId);
  return changes;
}

export function summarizeAssortmentImpact(input: {
  changes: AssortmentStatusChange[];
  mappingCountByCategoryId?: Record<number, number>;
  orderItemCountByCategoryId?: Record<number, number>;
  /** Active/reviewed mapping counts per category (legacy-safe reporting). */
  activeMappingCountByCategoryId?: Record<number, number>;
  highImpactThreshold?: number;
}): AssortmentImpactSummary {
  const threshold = input.highImpactThreshold ?? resolveHighImpactThreshold();
  const mappingBy = input.mappingCountByCategoryId || {};
  const orderBy = input.orderItemCountByCategoryId || {};
  const activeBy = input.activeMappingCountByCategoryId || mappingBy;

  let impactedLive = 0;
  let impactedDisc = 0;
  let existingMappingCount = 0;
  let existingOrderItemCount = 0;
  let mappingsExcludedFromQueueCount = 0;
  let inProductsLeavingScope = 0;
  const highRiskReasons: string[] = [];
  const scopeExpansionHints: string[] = [];

  for (const c of input.changes) {
    impactedLive += c.liveProducts;
    impactedDisc += c.discoverableProducts;
    const maps = Number(mappingBy[c.categoryId] || 0);
    const orders = Number(orderBy[c.categoryId] || 0);
    const activeMaps = Number(activeBy[c.categoryId] || 0);
    existingMappingCount += maps;
    existingOrderItemCount += orders;

    if (
      c.fromStatus === 'IN_SCOPE' &&
      (c.toStatus === 'OUT_OF_SCOPE' || c.toStatus === 'REVIEW_REQUIRED')
    ) {
      inProductsLeavingScope += c.discoverableProducts;
      if (activeMaps > 0) mappingsExcludedFromQueueCount += activeMaps;
    }

    if (
      c.fromStatus === 'IN_SCOPE' &&
      c.toStatus === 'OUT_OF_SCOPE' &&
      c.discoverableProducts >= threshold
    ) {
      highRiskReasons.push('in_to_out_high_products');
    }
    if (
      c.fromStatus === 'IN_SCOPE' &&
      c.toStatus === 'OUT_OF_SCOPE' &&
      orders > 0
    ) {
      highRiskReasons.push('in_to_out_order_history');
    }
    if (
      (c.toStatus === 'OUT_OF_SCOPE' || c.toStatus === 'REVIEW_REQUIRED') &&
      activeMaps > 0 &&
      c.fromStatus === 'IN_SCOPE'
    ) {
      highRiskReasons.push('in_leaving_with_active_mapping');
    }
  }

  // Parent override that leaves descendants on a different path-rule outcome
  // is informational scope-expansion detection (not enforced this phase).
  if (input.changes.length > 1) {
    scopeExpansionHints.push('descendant_status_changes_detected');
  }

  const uniqueReasons = [...new Set(highRiskReasons)];
  return {
    impactedCategoryCount: input.changes.length,
    impactedLiveProductCount: impactedLive,
    impactedDiscoverableProductCount: impactedDisc,
    existingMappingCount,
    existingOrderItemCount,
    changes: input.changes,
    mappingsExcludedFromQueueCount,
    inProductsLeavingScope,
    confirmationRequired: uniqueReasons.length > 0,
    highRiskReasons: uniqueReasons,
    scopeExpansionHints,
    operational: computeAssortmentOperationalImpact(input.changes),
  };
}

/** Hypothetically apply / replace a category override in a rule list. */
export function withHypotheticalCategoryOverride(input: {
  rules: Array<{
    id: number;
    provider: string | null;
    matchType: string;
    pathPrefixNorm: string | null;
    categoryId: number | null;
    status: AssortmentPolicyStatus;
    reasonCode: string;
    businessDomain: string | null;
    isActive: boolean;
  }>;
  categoryId: number;
  targetStatus: AssortmentPolicyStatus;
  reasonCode?: string;
  businessDomain?: string | null;
  /** Synthetic id used when no existing override; must be unique and low. */
  syntheticRuleId?: number;
}): typeof input.rules {
  const reason = input.reasonCode || 'EMPLOYEE_OVERRIDE';
  const existingIdx = input.rules.findIndex(
    (r) =>
      r.isActive &&
      r.matchType === 'category' &&
      Number(r.categoryId) === Number(input.categoryId),
  );
  if (existingIdx >= 0) {
    return input.rules.map((r, i) =>
      i === existingIdx
        ? {
            ...r,
            status: input.targetStatus,
            reasonCode: reason,
            businessDomain:
              input.businessDomain !== undefined
                ? input.businessDomain
                : r.businessDomain,
            isActive: true,
          }
        : r,
    );
  }
  const syntheticId =
    input.syntheticRuleId ??
    Math.min(0, ...input.rules.map((r) => Number(r.id))) - 1;
  return [
    ...input.rules,
    {
      id: syntheticId,
      provider: null,
      matchType: 'category',
      pathPrefixNorm: null,
      categoryId: input.categoryId,
      status: input.targetStatus,
      reasonCode: reason,
      businessDomain: input.businessDomain ?? null,
      isActive: true,
    },
  ];
}

export function assertValidAssortmentStatus(
  status: string,
): AssortmentPolicyStatus {
  if (
    status !== 'IN_SCOPE' &&
    status !== 'OUT_OF_SCOPE' &&
    status !== 'REVIEW_REQUIRED'
  ) {
    throw new AssortmentPolicyAdminValidationError(
      `Invalid assortment status: ${status}`,
      'invalid_status',
    );
  }
  return status;
}
