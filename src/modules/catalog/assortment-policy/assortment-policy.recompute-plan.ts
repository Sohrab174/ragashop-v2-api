/**
 * SCOPE-3/4 — pure recompute planning (no Nest/DB).
 *
 * Policy version semantics:
 *   - active rules unchanged AND resolutions unchanged → no-op, version stays
 *   - anything changed → version advances by exactly one
 */
import { createHash } from 'crypto';
import {
  AssortmentPolicyDecision,
  AssortmentPolicyRuleInput,
} from './assortment-policy.types';

export type PersistedResolutionLike = {
  categoryId: number;
  status: string;
  reasonCode: string;
  ruleId: number | null;
  via: string;
  businessDomain: string | null;
};

export type AssortmentRecomputePlan = {
  changed: boolean;
  previousVersion: number;
  policyVersion: number;
  changedCategoryIds: number[];
  removedCategoryIds: number[];
  rulesChanged: boolean;
  ruleFingerprint: string;
};

export function isSameResolution(
  prev: PersistedResolutionLike,
  next: PersistedResolutionLike,
): boolean {
  return (
    prev.status === next.status &&
    prev.reasonCode === next.reasonCode &&
    (prev.ruleId == null ? null : Number(prev.ruleId)) ===
      (next.ruleId == null ? null : Number(next.ruleId)) &&
    prev.via === next.via &&
    (prev.businessDomain ?? null) === (next.businessDomain ?? null)
  );
}

export function diffResolutions(
  previous: PersistedResolutionLike[],
  decisions: PersistedResolutionLike[],
): { changedCategoryIds: number[]; removedCategoryIds: number[] } {
  const prevById = new Map(previous.map((r) => [Number(r.categoryId), r]));
  const nextIds = new Set<number>();
  const changedCategoryIds: number[] = [];
  for (const d of decisions) {
    const id = Number(d.categoryId);
    nextIds.add(id);
    const prev = prevById.get(id);
    if (!prev || !isSameResolution(prev, d)) changedCategoryIds.push(id);
  }
  const removedCategoryIds = [...prevById.keys()].filter(
    (id) => !nextIds.has(id),
  );
  changedCategoryIds.sort((a, b) => a - b);
  removedCategoryIds.sort((a, b) => a - b);
  return { changedCategoryIds, removedCategoryIds };
}

/** Semantic fingerprint of the active rule set (notes/actors excluded). */
export function activeRuleFingerprint(
  rules: AssortmentPolicyRuleInput[],
): string {
  const rows = rules
    .filter((r) => r.isActive)
    .map((r) => [
      Number(r.id),
      r.provider ?? null,
      r.matchType,
      r.pathPrefixNorm ?? null,
      r.categoryId == null ? null : Number(r.categoryId),
      r.status,
      r.reasonCode,
      r.businessDomain ?? null,
    ])
    .sort((a, b) => (a[0] as number) - (b[0] as number));
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

export function planAssortmentRecompute(input: {
  previousVersion: number;
  previousResolutions: PersistedResolutionLike[];
  decisions: AssortmentPolicyDecision[];
  rules: AssortmentPolicyRuleInput[];
  /** Fingerprint stored by the last successful recompute, if any. */
  lastRuleFingerprint?: string | null;
  /** Caller knows the rule set was mutated in the same transaction. */
  rulesChanged?: boolean;
}): AssortmentRecomputePlan {
  const previousVersion = Number(input.previousVersion) || 0;
  const ruleFingerprint = activeRuleFingerprint(input.rules);
  const { changedCategoryIds, removedCategoryIds } = diffResolutions(
    input.previousResolutions,
    input.decisions,
  );
  const fingerprintDiffers =
    !!input.lastRuleFingerprint &&
    input.lastRuleFingerprint !== ruleFingerprint;
  const rulesChanged = !!input.rulesChanged || fingerprintDiffers;
  const changed =
    rulesChanged ||
    changedCategoryIds.length > 0 ||
    removedCategoryIds.length > 0;
  return {
    changed,
    previousVersion,
    policyVersion: changed ? previousVersion + 1 : previousVersion,
    changedCategoryIds,
    removedCategoryIds,
    rulesChanged,
    ruleFingerprint,
  };
}
