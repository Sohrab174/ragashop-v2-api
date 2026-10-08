import {
  buildCategorySelectorKey,
  buildPathSelectorKey,
  normalizePathPrefix,
} from './assortment-path.normalize';
import {
  ASSORTMENT_POLICY_MATCH_TYPES,
  ASSORTMENT_POLICY_STATUSES,
  AssortmentPolicyMatchType,
  AssortmentPolicyStatus,
  AssortmentRuleDraft,
} from './assortment-policy.types';

export class AssortmentPolicyRuleValidationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid_match_type'
      | 'invalid_status'
      | 'invalid_selector'
      | 'duplicate_selector'
      | 'invalid_reason' = 'invalid_selector',
  ) {
    super(message);
    this.name = 'AssortmentPolicyRuleValidationError';
  }
}

export type ValidatedAssortmentRule = {
  provider: string | null;
  matchType: AssortmentPolicyMatchType;
  pathPrefixNorm: string | null;
  categoryId: number | null;
  selectorKey: string;
  status: AssortmentPolicyStatus;
  reasonCode: string;
  businessDomain: string | null;
  note: string | null;
  isActive: boolean;
};

function assertStatus(status: string): AssortmentPolicyStatus {
  if (!(ASSORTMENT_POLICY_STATUSES as readonly string[]).includes(status)) {
    throw new AssortmentPolicyRuleValidationError(
      `Invalid assortment status: ${status}`,
      'invalid_status',
    );
  }
  return status as AssortmentPolicyStatus;
}

function assertMatchType(matchType: string): AssortmentPolicyMatchType {
  if (
    !(ASSORTMENT_POLICY_MATCH_TYPES as readonly string[]).includes(matchType)
  ) {
    throw new AssortmentPolicyRuleValidationError(
      `Invalid matchType: ${matchType}`,
      'invalid_match_type',
    );
  }
  return matchType as AssortmentPolicyMatchType;
}

/**
 * Structural validation for a rule draft.
 * Rejects ambiguous selector combinations.
 */
export function validateAssortmentRuleDraft(
  draft: AssortmentRuleDraft,
): ValidatedAssortmentRule {
  const matchType = assertMatchType(draft.matchType);
  const status = assertStatus(draft.status);
  const reasonCode = String(draft.reasonCode || '').trim();
  if (!reasonCode) {
    throw new AssortmentPolicyRuleValidationError(
      'reasonCode is required',
      'invalid_reason',
    );
  }

  const isActive = draft.isActive !== false;
  const businessDomain =
    draft.businessDomain == null || draft.businessDomain === ''
      ? null
      : String(draft.businessDomain);
  const note =
    draft.note == null || draft.note === '' ? null : String(draft.note);

  if (matchType === 'category') {
    const categoryId = Number(draft.categoryId);
    if (
      draft.categoryId == null ||
      !Number.isInteger(categoryId) ||
      categoryId <= 0
    ) {
      throw new AssortmentPolicyRuleValidationError(
        'category matchType requires a positive categoryId',
        'invalid_selector',
      );
    }
    if (draft.pathPrefix != null && String(draft.pathPrefix).trim() !== '') {
      throw new AssortmentPolicyRuleValidationError(
        'category matchType must not set pathPrefix',
        'invalid_selector',
      );
    }
    return {
      provider:
        draft.provider == null || draft.provider === ''
          ? null
          : String(draft.provider),
      matchType,
      pathPrefixNorm: null,
      categoryId,
      selectorKey: buildCategorySelectorKey(categoryId),
      status,
      reasonCode,
      businessDomain,
      note,
      isActive,
    };
  }

  // path_prefix
  const provider = String(draft.provider || '').trim();
  if (!provider) {
    throw new AssortmentPolicyRuleValidationError(
      'path_prefix matchType requires provider',
      'invalid_selector',
    );
  }
  if (draft.categoryId != null) {
    throw new AssortmentPolicyRuleValidationError(
      'path_prefix matchType must not set categoryId',
      'invalid_selector',
    );
  }
  const pathPrefixNorm = normalizePathPrefix(String(draft.pathPrefix || ''));
  if (!pathPrefixNorm) {
    throw new AssortmentPolicyRuleValidationError(
      'path_prefix matchType requires a non-empty normalized path',
      'invalid_selector',
    );
  }

  return {
    provider,
    matchType,
    pathPrefixNorm,
    categoryId: null,
    selectorKey: buildPathSelectorKey(provider, pathPrefixNorm),
    status,
    reasonCode,
    businessDomain,
    note,
    isActive,
  };
}

/** Detect duplicate active selectors in a candidate set (deterministic). */
export function findDuplicateActiveSelectors(
  rules: Array<{ selectorKey: string; isActive: boolean; id?: number }>,
): string[] {
  const seen = new Map<string, number>();
  const dupes = new Set<string>();
  for (const rule of rules) {
    if (!rule.isActive) continue;
    const prev = seen.get(rule.selectorKey);
    if (prev != null) {
      dupes.add(rule.selectorKey);
    } else {
      seen.set(rule.selectorKey, rule.id ?? -1);
    }
  }
  return [...dupes].sort();
}
