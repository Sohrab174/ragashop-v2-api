import {
  CAT3B_FORBIDDEN_KIDS_SOURCE_CATEGORY_IDS,
} from './phase-cat2-deepen-local-canonical.seed';

describe('CAT-2 deepen seed — CAT-3B kids recontamination guard', () => {
  it('forbids over-broad Clothing/Shoes sources under kids', () => {
    expect(CAT3B_FORBIDDEN_KIDS_SOURCE_CATEGORY_IDS).toEqual([
      2, 17, 79, 80, 148,
    ]);
  });

  it('does not forbid valid Bebek or ambiguous Set sources', () => {
    const forbidden = new Set<number>(CAT3B_FORBIDDEN_KIDS_SOURCE_CATEGORY_IDS);
    expect(forbidden.has(339)).toBe(false);
    expect(forbidden.has(200)).toBe(false);
  });
});