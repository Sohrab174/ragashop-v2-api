/**
 * SCOPE-5/6 — Assortment enforcement for discovery, commerce, and crawler.
 *
 * Single policy authority: category_assortment_resolution.
 * Feature flags default OFF (shadow-safe); set = '1' to enforce locally.
 */

import { SelectQueryBuilder } from 'typeorm';
import { AssortmentPolicyStatus } from './assortment-policy.types';

export const ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV =
  'ASSORTMENT_DISCOVERY_ENFORCEMENT';
export const ASSORTMENT_COMMERCE_ENFORCEMENT_ENV =
  'ASSORTMENT_COMMERCE_ENFORCEMENT';
export const ASSORTMENT_CRAWLER_ENFORCEMENT_ENV =
  'ASSORTMENT_CRAWLER_ENFORCEMENT';

export function isAssortmentDiscoveryEnforcementEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV] === '1';
}

export function isAssortmentCommerceEnforcementEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[ASSORTMENT_COMMERCE_ENFORCEMENT_ENV] === '1';
}

export function isAssortmentCrawlerEnforcementEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[ASSORTMENT_CRAWLER_ENFORCEMENT_ENV] === '1';
}

export type AssortmentCommerceCode =
  | 'ASSORTMENT_IN_SCOPE'
  | 'ASSORTMENT_REVIEW_REQUIRED'
  | 'ASSORTMENT_OUT_OF_SCOPE'
  | 'ASSORTMENT_UNRESOLVED';

export type AssortmentCommerceDecision = {
  purchasable: boolean;
  discoverable: boolean;
  code: AssortmentCommerceCode;
  status: AssortmentPolicyStatus | null;
  /** Customer-safe Persian message (never exposes enums). */
  customerMessage: string;
};

export const ASSORTMENT_OUT_CUSTOMER_MESSAGE =
  'این کالا در حال حاضر از طریق راگاشاپ قابل سفارش نیست.';
export const ASSORTMENT_REVIEW_CUSTOMER_MESSAGE =
  'امکان خرید و ارسال این کالا نیاز به بررسی دارد.';

/**
 * Fail-closed commerce/discovery evaluation for a product's source category.
 * Missing / unknown status ⇒ REVIEW semantics (never silent IN, never silent OUT).
 */
export function evaluateAssortmentCommerceGate(
  status: string | null | undefined,
): AssortmentCommerceDecision {
  if (status === 'IN_SCOPE') {
    return {
      purchasable: true,
      discoverable: true,
      code: 'ASSORTMENT_IN_SCOPE',
      status: 'IN_SCOPE',
      customerMessage: '',
    };
  }
  if (status === 'OUT_OF_SCOPE') {
    return {
      purchasable: false,
      discoverable: false,
      code: 'ASSORTMENT_OUT_OF_SCOPE',
      status: 'OUT_OF_SCOPE',
      customerMessage: ASSORTMENT_OUT_CUSTOMER_MESSAGE,
    };
  }
  if (status === 'REVIEW_REQUIRED') {
    return {
      purchasable: false,
      discoverable: false,
      code: 'ASSORTMENT_REVIEW_REQUIRED',
      status: 'REVIEW_REQUIRED',
      customerMessage: ASSORTMENT_REVIEW_CUSTOMER_MESSAGE,
    };
  }
  return {
    purchasable: false,
    discoverable: false,
    code: 'ASSORTMENT_UNRESOLVED',
    status: null,
    customerMessage: ASSORTMENT_REVIEW_CUSTOMER_MESSAGE,
  };
}

/**
 * PDP availability overlay. IN ⇒ unchanged; otherwise not purchasable with a
 * customer-safe state (never enums / reason codes / policyVersion).
 */
export function applyAssortmentDecisionToAvailability<
  T extends { purchasable: boolean },
>(
  availability: T,
  decision: AssortmentCommerceDecision,
): T & {
  assortmentState?: 'review_required' | 'unavailable';
  assortmentMessage?: string;
} {
  if (decision.purchasable) return availability;
  return {
    ...availability,
    purchasable: false,
    assortmentState:
      decision.code === 'ASSORTMENT_OUT_OF_SCOPE'
        ? 'unavailable'
        : 'review_required',
    assortmentMessage: decision.customerMessage,
  };
}

export function isAssortmentDiscoverableStatus(
  status: string | null | undefined,
): boolean {
  return evaluateAssortmentCommerceGate(status).discoverable;
}

function readStatus(
  statusByCategoryId: Map<number, string> | Record<number, string>,
  id: number,
): string | undefined {
  if (statusByCategoryId instanceof Map) return statusByCategoryId.get(id);
  return (statusByCategoryId as Record<number, string>)[id];
}

/** Keep only IN_SCOPE ids (ancestor leakage subtraction). */
export function filterInScopeSourceCategoryIds(
  categoryIds: number[],
  statusByCategoryId: Map<number, string> | Record<number, string>,
): number[] {
  return categoryIds.filter((id) =>
    isAssortmentDiscoverableStatus(readStatus(statusByCategoryId, id)),
  );
}

/**
 * SQL: product.categoryId must resolve to IN_SCOPE.
 * Missing resolution rows fail closed (NOT IN_SCOPE).
 * Safe to AND into listing/search builders when enforcement is on.
 */
export function assortmentInScopeDiscoverySql(
  productAlias = 'product',
  resolutionAlias = 'assortment_res',
): string {
  return `EXISTS (
    SELECT 1 FROM category_assortment_resolution ${resolutionAlias}
    WHERE ${resolutionAlias}.categoryId = ${productAlias}.categoryId
      AND ${resolutionAlias}.status = 'IN_SCOPE'
  )`;
}

/** Apply IN_SCOPE discovery predicate when the discovery flag is enabled. */
export function applyAssortmentDiscoveryFilter<T>(
  builder: SelectQueryBuilder<T>,
  alias = 'product',
  env: NodeJS.ProcessEnv = process.env,
): SelectQueryBuilder<T> {
  if (!isAssortmentDiscoveryEnforcementEnabled(env)) {
    return builder;
  }
  return builder.andWhere(assortmentInScopeDiscoverySql(alias));
}

/** Subtract non-IN categories from an eligibility clause id list. */
export function subtractNonInScopeFromClauses<
  T extends { sourceCategoryIds: number[] },
>(
  clauses: T[],
  statusByCategoryId: Map<number, string> | Record<number, string>,
): T[] {
  return clauses
    .map((clause) => ({
      ...clause,
      sourceCategoryIds: filterInScopeSourceCategoryIds(
        clause.sourceCategoryIds,
        statusByCategoryId,
      ),
    }))
    .filter((clause) => clause.sourceCategoryIds.length > 0);
}

/** Internal crawler snapshot row (minimal). */
export type AssortmentPolicySnapshotRow = {
  sourceCategoryId: number;
  status: AssortmentPolicyStatus;
  reasonCode: string;
};

export type AssortmentPolicySnapshot = {
  policyVersion: number;
  generatedAt: string;
  provider: string | null;
  resolutions: AssortmentPolicySnapshotRow[];
};

export type CrawlerAssortmentGateAction =
  | 'PROCEED_IN_SCOPE'
  | 'SKIP_REVIEW_REQUIRED'
  | 'SKIP_OUT_OF_SCOPE'
  | 'FAIL_CLOSED_NO_POLICY'
  | 'FAIL_CLOSED_STALE'
  | 'FAIL_CLOSED_UNKNOWN';

export type CrawlerAssortmentGateResult = {
  action: CrawlerAssortmentGateAction;
  status: AssortmentPolicyStatus | null;
  operationalCode:
    | 'CATEGORY_IN_SCOPE'
    | 'CATEGORY_REVIEW_REQUIRED'
    | 'CATEGORY_OUT_OF_SCOPE'
    | 'POLICY_UNAVAILABLE'
    | 'POLICY_STALE'
    | 'CATEGORY_UNKNOWN';
};

/**
 * Crawler gate over a cached snapshot lookup.
 * noSnapshot / stale ⇒ fail closed for listing/refresh.
 * missing category in an otherwise valid snapshot ⇒ unknown (fail closed for bulk).
 */
export function resolveCrawlerAssortmentGate(input: {
  hasValidSnapshot: boolean;
  isStale: boolean;
  status: string | null | undefined;
}): CrawlerAssortmentGateResult {
  if (!input.hasValidSnapshot) {
    return {
      action: 'FAIL_CLOSED_NO_POLICY',
      status: null,
      operationalCode: 'POLICY_UNAVAILABLE',
    };
  }
  if (input.isStale) {
    return {
      action: 'FAIL_CLOSED_STALE',
      status: null,
      operationalCode: 'POLICY_STALE',
    };
  }
  if (input.status === 'IN_SCOPE') {
    return {
      action: 'PROCEED_IN_SCOPE',
      status: 'IN_SCOPE',
      operationalCode: 'CATEGORY_IN_SCOPE',
    };
  }
  if (input.status === 'OUT_OF_SCOPE') {
    return {
      action: 'SKIP_OUT_OF_SCOPE',
      status: 'OUT_OF_SCOPE',
      operationalCode: 'CATEGORY_OUT_OF_SCOPE',
    };
  }
  if (input.status === 'REVIEW_REQUIRED') {
    return {
      action: 'SKIP_REVIEW_REQUIRED',
      status: 'REVIEW_REQUIRED',
      operationalCode: 'CATEGORY_REVIEW_REQUIRED',
    };
  }
  return {
    action: 'FAIL_CLOSED_UNKNOWN',
    status: null,
    operationalCode: 'CATEGORY_UNKNOWN',
  };
}

/** Paste-link when policy service is temporarily unavailable. */
export function pasteLinkPolicyUnavailableDecision(): AssortmentCommerceDecision {
  return evaluateAssortmentCommerceGate(null);
}
