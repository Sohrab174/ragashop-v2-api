import {
  isSegmentPrefix,
  normalizePathSegments,
} from './assortment-path.normalize';
import {
  AssortmentCategoryInput,
  AssortmentEvaluateInput,
  AssortmentPolicyDecision,
  AssortmentPolicyRuleInput,
  AssortmentPolicyStatus,
} from './assortment-policy.types';

type InternalDecision = Omit<AssortmentPolicyDecision, 'policyVersion'>;

function sortRulesDeterministically(
  rules: AssortmentPolicyRuleInput[],
): AssortmentPolicyRuleInput[] {
  return [...rules].sort((a, b) => {
    if (a.id !== b.id) return a.id - b.id;
    return 0;
  });
}

function matchLongestPathRule(
  provider: string,
  hierarchy: string,
  pathRules: AssortmentPolicyRuleInput[],
): AssortmentPolicyRuleInput | null {
  const segs = normalizePathSegments(hierarchy);
  let best: AssortmentPolicyRuleInput | null = null;
  let bestLen = -1;
  let bestId = Number.POSITIVE_INFINITY;

  for (const rule of pathRules) {
    if (!rule.isActive || rule.matchType !== 'path_prefix') continue;
    if (rule.provider !== provider) continue;
    if (!rule.pathPrefixNorm) continue;
    const prefix = normalizePathSegments(rule.pathPrefixNorm);
    if (!isSegmentPrefix(segs, prefix)) continue;
    if (
      prefix.length > bestLen ||
      (prefix.length === bestLen && rule.id < bestId)
    ) {
      best = rule;
      bestLen = prefix.length;
      bestId = rule.id;
    }
  }
  return best;
}

/**
 * Pure deterministic assortment evaluator.
 * No DB access. Row order of rules/categories must not affect results.
 *
 * Precedence:
 * 1. exact category override
 * 2. longest provider + normalized path prefix
 * 3. descendant consensus (live-product weighted)
 * 4. approved domain default (optional input)
 * 5. REVIEW_REQUIRED / UNCLASSIFIED
 *
 * Uncertainty never becomes OUT_OF_SCOPE.
 */
export function evaluateAssortmentPolicy(
  input: AssortmentEvaluateInput,
): AssortmentPolicyDecision[] {
  const categories = [...input.categories].sort((a, b) => a.id - b.id);
  const rules = sortRulesDeterministically(input.rules).filter(
    (r) => r.isActive,
  );
  const live = input.liveProductCountByCategoryId || {};
  const domainDefaults = input.domainDefaults || {};
  const policyVersion = Number(input.policyVersion) || 0;

  const byId = new Map<number, AssortmentCategoryInput>();
  const children = new Map<number, number[]>();
  for (const c of categories) {
    byId.set(c.id, c);
  }
  for (const c of categories) {
    if (c.parentId == null) continue;
    if (!byId.has(c.parentId)) continue;
    const list = children.get(c.parentId) || [];
    list.push(c.id);
    children.set(c.parentId, list);
  }
  for (const [parentId, kids] of children) {
    children.set(
      parentId,
      [...kids].sort((a, b) => a - b),
    );
  }

  const categoryOverrides = new Map<number, AssortmentPolicyRuleInput>();
  const pathRules: AssortmentPolicyRuleInput[] = [];
  for (const rule of rules) {
    if (rule.matchType === 'category' && rule.categoryId != null) {
      const existing = categoryOverrides.get(rule.categoryId);
      if (!existing || rule.id < existing.id) {
        categoryOverrides.set(rule.categoryId, rule);
      }
    } else if (rule.matchType === 'path_prefix') {
      pathRules.push(rule);
    }
  }

  const subtreeLive = new Map<number, number>();
  const subtreeLiveOf = (id: number): number => {
    if (subtreeLive.has(id)) return subtreeLive.get(id) as number;
    const own = Number(live[id] || 0);
    const total = (children.get(id) || []).reduce(
      (sum, childId) => sum + subtreeLiveOf(childId),
      own,
    );
    subtreeLive.set(id, total);
    return total;
  };

  const decisions = new Map<number, InternalDecision>();

  const decide = (id: number): InternalDecision => {
    const cached = decisions.get(id);
    if (cached) return cached;

    const category = byId.get(id);
    if (!category) {
      const fallback: InternalDecision = {
        categoryId: id,
        status: 'REVIEW_REQUIRED',
        reasonCode: 'UNCLASSIFIED',
        ruleId: null,
        via: 'unclassified',
        businessDomain: 'unknown',
      };
      decisions.set(id, fallback);
      return fallback;
    }

    let decision: InternalDecision | null = null;

    // 1) Exact category override
    const override = categoryOverrides.get(id);
    if (override) {
      decision = {
        categoryId: id,
        status: override.status,
        reasonCode: override.reasonCode,
        ruleId: override.id,
        via: 'category_override',
        businessDomain: override.businessDomain,
      };
    }

    // 2) Longest path prefix
    if (
      !decision &&
      category.hierarchy &&
      category.source &&
      String(category.source).trim() !== ''
    ) {
      const matched = matchLongestPathRule(
        String(category.source),
        category.hierarchy,
        pathRules,
      );
      if (matched) {
        decision = {
          categoryId: id,
          status: matched.status,
          reasonCode: matched.reasonCode,
          ruleId: matched.id,
          via: 'provider_path',
          businessDomain: matched.businessDomain,
        };
      }
    }

    // 3) Descendant consensus
    if (!decision) {
      const kids = (children.get(id) || []).map((childId) => ({
        decision: decide(childId),
        weight: subtreeLiveOf(childId),
      }));
      const informative = kids.filter(
        (k) => k.decision.via !== 'unclassified' && k.weight > 0,
      );
      if (informative.length) {
        const statuses = new Set<AssortmentPolicyStatus>(
          informative.map((k) => k.decision.status),
        );
        const top = [...informative].sort((a, b) => {
          if (b.weight !== a.weight) return b.weight - a.weight;
          return a.decision.categoryId - b.decision.categoryId;
        })[0].decision;

        const ownDomain = category.engineDomain || null;
        const domainDefault =
          ownDomain && domainDefaults[ownDomain]
            ? domainDefaults[ownDomain]
            : null;
        const businessDomain =
          domainDefault?.businessDomain || top.businessDomain;

        if (statuses.size === 1) {
          decision = {
            categoryId: id,
            status: top.status,
            reasonCode: top.reasonCode,
            ruleId: null,
            via: 'descendants',
            businessDomain,
          };
        } else {
          decision = {
            categoryId: id,
            status: 'REVIEW_REQUIRED',
            reasonCode: 'MIXED_DESCENDANT_POLICY',
            ruleId: null,
            via: 'descendants',
            businessDomain,
          };
        }
      }
    }

    // 4) Approved domain default
    if (!decision) {
      const ownDomain = category.engineDomain || null;
      const domainDefault =
        ownDomain && domainDefaults[ownDomain]
          ? domainDefaults[ownDomain]
          : null;
      if (domainDefault) {
        decision = {
          categoryId: id,
          status: domainDefault.status,
          reasonCode: domainDefault.reasonCode || 'DOMAIN_DEFAULT',
          ruleId: null,
          via: 'domain_default',
          businessDomain: domainDefault.businessDomain,
        };
      }
    }

    // 5) Fail-safe REVIEW
    if (!decision) {
      decision = {
        categoryId: id,
        status: 'REVIEW_REQUIRED',
        reasonCode: 'UNCLASSIFIED',
        ruleId: null,
        via: 'unclassified',
        businessDomain: 'unknown',
      };
    }

    decisions.set(id, decision);
    return decision;
  };

  for (const c of categories) {
    decide(c.id);
  }

  return categories.map((c) => {
    const d = decisions.get(c.id) as InternalDecision;
    return {
      ...d,
      policyVersion,
    };
  });
}

/** Summarize decisions by status (stable keys). */
export function summarizeAssortmentDecisions(
  decisions: AssortmentPolicyDecision[],
): Record<AssortmentPolicyStatus, number> {
  const out: Record<AssortmentPolicyStatus, number> = {
    IN_SCOPE: 0,
    OUT_OF_SCOPE: 0,
    REVIEW_REQUIRED: 0,
  };
  for (const d of decisions) {
    out[d.status] = (out[d.status] || 0) + 1;
  }
  return out;
}
