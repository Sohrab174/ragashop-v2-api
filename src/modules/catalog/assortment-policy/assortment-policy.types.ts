/**
 * SCOPE-2 — Assortment policy shared types (pure; no Nest/DB).
 *
 * Consumable later by API, crawler, AUTO-MAP, discovery, Admin preview.
 * This module is intentionally framework-free so it can be extracted to
 * packages/assortment-policy without logic duplication.
 */

export const ASSORTMENT_POLICY_STATUSES = [
  'IN_SCOPE',
  'OUT_OF_SCOPE',
  'REVIEW_REQUIRED',
] as const;

export type AssortmentPolicyStatus = typeof ASSORTMENT_POLICY_STATUSES[number];

export const ASSORTMENT_POLICY_MATCH_TYPES = [
  'path_prefix',
  'category',
] as const;

export type AssortmentPolicyMatchType =
  typeof ASSORTMENT_POLICY_MATCH_TYPES[number];

export const ASSORTMENT_POLICY_REASON_CODES = [
  'TARGET_FASHION',
  'TARGET_ACCESSORY',
  'TARGET_BEAUTY',
  'TARGET_EXISTING_CANONICAL_ROOT',
  'BULKY_FURNITURE',
  'BULKY_HEAVY',
  'HOME_GOODS_NOT_YET_DECIDED',
  'HEAVY_TEXTILE_SIZE_UNKNOWN',
  'FRAGILE_OR_BULKY',
  'SENSITIVE_ADULT',
  'SAFETY_REGULATED',
  'KIDS_GOODS_NOT_YET_DECIDED',
  'BULKY_EXISTING_CANONICAL',
  'BULKY_BATTERY_EXISTING_CANONICAL',
  'NOT_TARGETED_YET',
  'UNCLASSIFIED',
  'MIXED_DESCENDANT_POLICY',
  'DOMAIN_DEFAULT',
  /** Admin employee per-category decision (SCOPE-3/4). */
  'EMPLOYEE_OVERRIDE',
] as const;

export type AssortmentPolicyReasonCode =
  typeof ASSORTMENT_POLICY_REASON_CODES[number];

export const ASSORTMENT_POLICY_VIA = [
  'category_override',
  'provider_path',
  'descendants',
  'domain_default',
  'unclassified',
] as const;

export type AssortmentPolicyVia = typeof ASSORTMENT_POLICY_VIA[number];

export type AssortmentPolicyRuleInput = {
  id: number;
  provider: string | null;
  matchType: AssortmentPolicyMatchType;
  pathPrefixNorm: string | null;
  categoryId: number | null;
  status: AssortmentPolicyStatus;
  reasonCode: string;
  businessDomain: string | null;
  isActive: boolean;
};

export type AssortmentCategoryInput = {
  id: number;
  parentId: number | null;
  source: string | null;
  hierarchy: string | null;
  /** Optional engine/domain hint for approved domain defaults. Never invents OUT. */
  engineDomain?: string | null;
};

export type AssortmentDomainDefault = {
  status: AssortmentPolicyStatus;
  reasonCode?: string;
  businessDomain: string;
};

export type AssortmentEvaluateInput = {
  categories: AssortmentCategoryInput[];
  rules: AssortmentPolicyRuleInput[];
  /** Live (isDeleted=0) product counts by categoryId — weights descendant consensus. */
  liveProductCountByCategoryId: Record<number, number>;
  policyVersion: number;
  /** Approved domain defaults keyed by engineDomain. Optional. */
  domainDefaults?: Record<string, AssortmentDomainDefault>;
};

export type AssortmentPolicyDecision = {
  categoryId: number;
  status: AssortmentPolicyStatus;
  reasonCode: string;
  ruleId: number | null;
  via: AssortmentPolicyVia;
  businessDomain: string | null;
  policyVersion: number;
};

export type AssortmentRuleDraft = {
  provider: string | null;
  matchType: AssortmentPolicyMatchType;
  pathPrefix: string | null;
  categoryId: number | null;
  status: AssortmentPolicyStatus;
  reasonCode: string;
  businessDomain: string | null;
  note?: string | null;
  isActive?: boolean;
};
