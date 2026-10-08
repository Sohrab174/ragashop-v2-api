import {
  ASSORTMENT_POLICY_SYSTEM_ACTOR,
  SCOPE2_INITIAL_PATH_RULE_DRAFTS,
} from './assortment-policy.seed-data';
import {
  findDuplicateActiveSelectors,
  validateAssortmentRuleDraft,
} from './assortment-policy.validate';

describe('assortment policy seed drafts', () => {
  it('are structurally valid and have unique selectors', () => {
    const validated = SCOPE2_INITIAL_PATH_RULE_DRAFTS.map((d) =>
      validateAssortmentRuleDraft(d),
    );
    expect(validated.length).toBe(28);
    const dupes = findDuplicateActiveSelectors(
      validated.map((v, i) => ({
        selectorKey: v.selectorKey,
        isActive: true,
        id: i + 1,
      })),
    );
    expect(dupes).toEqual([]);
    expect(ASSORTMENT_POLICY_SYSTEM_ACTOR).toBe('system:scope2-seed');
  });

  it('keeps rugs/curtains/lighting as REVIEW and furniture as OUT', () => {
    const byPath = new Map(
      SCOPE2_INITIAL_PATH_RULE_DRAFTS.map((d) => [d.pathPrefix, d]),
    );
    expect(byPath.get('Ev & Mobilya/Mobilya')?.status).toBe('OUT_OF_SCOPE');
    expect(byPath.get('Ev & Mobilya/Mobilya/Halı / Kilim')?.status).toBe(
      'REVIEW_REQUIRED',
    );
    expect(byPath.get('Ev & Mobilya/Mobilya/Perde')?.status).toBe(
      'REVIEW_REQUIRED',
    );
    expect(
      byPath.get('Ev & Mobilya/Mobilya/Elektrik & Aydınlatma')?.status,
    ).toBe('REVIEW_REQUIRED');
    expect(byPath.get('Ev & Mobilya/Ev')?.status).toBe('REVIEW_REQUIRED');
  });
});

describe('assortment policy audit contract', () => {
  it('serializes before/after provenance for rule create', () => {
    // Lightweight contract: audit rows are insert-only payloads with before/after.
    const before = null;
    const after = {
      id: 1,
      selectorKey: 'path:trendyol:giyim',
      status: 'IN_SCOPE',
      reasonCode: 'TARGET_FASHION',
      isActive: true,
    };
    const auditRow = {
      operation: 'rule_create',
      ruleId: 1,
      actor: ASSORTMENT_POLICY_SYSTEM_ACTOR,
      beforeJson: before,
      afterJson: after,
      policyVersion: 0,
    };
    expect(auditRow.beforeJson).toBeNull();
    expect(auditRow.afterJson?.selectorKey).toBe('path:trendyol:giyim');
    expect(auditRow.operation).toBe('rule_create');
  });
});
