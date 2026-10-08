import {
  applyAssortmentDiscoveryFilter,
  assortmentInScopeDiscoverySql,
  evaluateAssortmentCommerceGate,
  filterInScopeSourceCategoryIds,
  isAssortmentCommerceEnforcementEnabled,
  isAssortmentCrawlerEnforcementEnabled,
  isAssortmentDiscoveryEnforcementEnabled,
  pasteLinkPolicyUnavailableDecision,
  resolveCrawlerAssortmentGate,
  subtractNonInScopeFromClauses,
  ASSORTMENT_OUT_CUSTOMER_MESSAGE,
  ASSORTMENT_REVIEW_CUSTOMER_MESSAGE,
} from './assortment-enforcement';

describe('assortment-enforcement', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env.ASSORTMENT_DISCOVERY_ENFORCEMENT =
      prev.ASSORTMENT_DISCOVERY_ENFORCEMENT;
    process.env.ASSORTMENT_COMMERCE_ENFORCEMENT =
      prev.ASSORTMENT_COMMERCE_ENFORCEMENT;
    process.env.ASSORTMENT_CRAWLER_ENFORCEMENT =
      prev.ASSORTMENT_CRAWLER_ENFORCEMENT;
  });

  it('flags default off', () => {
    delete process.env.ASSORTMENT_DISCOVERY_ENFORCEMENT;
    delete process.env.ASSORTMENT_COMMERCE_ENFORCEMENT;
    delete process.env.ASSORTMENT_CRAWLER_ENFORCEMENT;
    expect(isAssortmentDiscoveryEnforcementEnabled()).toBe(false);
    expect(isAssortmentCommerceEnforcementEnabled()).toBe(false);
    expect(isAssortmentCrawlerEnforcementEnabled()).toBe(false);
  });

  it('IN discoverable and purchasable', () => {
    const d = evaluateAssortmentCommerceGate('IN_SCOPE');
    expect(d.purchasable).toBe(true);
    expect(d.discoverable).toBe(true);
    expect(d.code).toBe('ASSORTMENT_IN_SCOPE');
  });

  it('REVIEW excluded from discovery and purchase', () => {
    const d = evaluateAssortmentCommerceGate('REVIEW_REQUIRED');
    expect(d.purchasable).toBe(false);
    expect(d.discoverable).toBe(false);
    expect(d.code).toBe('ASSORTMENT_REVIEW_REQUIRED');
    expect(d.customerMessage).toBe(ASSORTMENT_REVIEW_CUSTOMER_MESSAGE);
  });

  it('OUT excluded from discovery and purchase', () => {
    const d = evaluateAssortmentCommerceGate('OUT_OF_SCOPE');
    expect(d.purchasable).toBe(false);
    expect(d.discoverable).toBe(false);
    expect(d.code).toBe('ASSORTMENT_OUT_OF_SCOPE');
    expect(d.customerMessage).toBe(ASSORTMENT_OUT_CUSTOMER_MESSAGE);
  });

  it('unknown / missing fails closed to REVIEW semantics (never IN)', () => {
    for (const status of [null, undefined, '', 'WEIRD']) {
      const d = evaluateAssortmentCommerceGate(status as any);
      expect(d.purchasable).toBe(false);
      expect(d.discoverable).toBe(false);
      expect(d.code).toBe('ASSORTMENT_UNRESOLVED');
      expect(d.customerMessage).toBe(ASSORTMENT_REVIEW_CUSTOMER_MESSAGE);
    }
  });

  it('subtracts REVIEW/OUT descendants from expanded scope (ancestor leakage)', () => {
    const status = new Map<number, string>([
      [10, 'IN_SCOPE'],
      [11, 'REVIEW_REQUIRED'],
      [12, 'OUT_OF_SCOPE'],
      [13, 'IN_SCOPE'],
    ]);
    expect(filterInScopeSourceCategoryIds([10, 11, 12, 13], status)).toEqual([
      10, 13,
    ]);
    const clauses = subtractNonInScopeFromClauses(
      [
        { slice: 'any', sourceCategoryIds: [10, 11, 12, 13], genders: null },
        { slice: 'female', sourceCategoryIds: [11], genders: ['female'] },
      ],
      status,
    );
    expect(clauses).toEqual([
      { slice: 'any', sourceCategoryIds: [10, 13], genders: null },
    ]);
  });

  it('discovery SQL requires IN_SCOPE resolution', () => {
    const sql = assortmentInScopeDiscoverySql('product');
    expect(sql).toContain('category_assortment_resolution');
    expect(sql).toContain("status = 'IN_SCOPE'");
    expect(sql).toContain('product.categoryId');
  });

  it('applyAssortmentDiscoveryFilter is no-op when flag off', () => {
    delete process.env.ASSORTMENT_DISCOVERY_ENFORCEMENT;
    const calls: string[] = [];
    const builder = {
      andWhere: (sql: string) => {
        calls.push(sql);
        return builder;
      },
    };
    applyAssortmentDiscoveryFilter(builder as any);
    expect(calls).toEqual([]);
  });

  it('applyAssortmentDiscoveryFilter ANDs when flag on', () => {
    process.env.ASSORTMENT_DISCOVERY_ENFORCEMENT = '1';
    const calls: string[] = [];
    const builder = {
      andWhere: (sql: string) => {
        calls.push(sql);
        return builder;
      },
    };
    applyAssortmentDiscoveryFilter(builder as any);
    expect(calls[0]).toContain('IN_SCOPE');
  });

  it('crawler gate: IN proceeds, REVIEW/OUT skip, no/stale/unknown fail closed', () => {
    expect(
      resolveCrawlerAssortmentGate({
        hasValidSnapshot: true,
        isStale: false,
        status: 'IN_SCOPE',
      }).action,
    ).toBe('PROCEED_IN_SCOPE');
    expect(
      resolveCrawlerAssortmentGate({
        hasValidSnapshot: true,
        isStale: false,
        status: 'REVIEW_REQUIRED',
      }).operationalCode,
    ).toBe('CATEGORY_REVIEW_REQUIRED');
    expect(
      resolveCrawlerAssortmentGate({
        hasValidSnapshot: true,
        isStale: false,
        status: 'OUT_OF_SCOPE',
      }).operationalCode,
    ).toBe('CATEGORY_OUT_OF_SCOPE');
    expect(
      resolveCrawlerAssortmentGate({
        hasValidSnapshot: false,
        isStale: false,
        status: 'IN_SCOPE',
      }).operationalCode,
    ).toBe('POLICY_UNAVAILABLE');
    expect(
      resolveCrawlerAssortmentGate({
        hasValidSnapshot: true,
        isStale: true,
        status: 'IN_SCOPE',
      }).operationalCode,
    ).toBe('POLICY_STALE');
    expect(
      resolveCrawlerAssortmentGate({
        hasValidSnapshot: true,
        isStale: false,
        status: null,
      }).operationalCode,
    ).toBe('CATEGORY_UNKNOWN');
  });

  it('paste-link policy unavailable uses REVIEW semantics', () => {
    const d = pasteLinkPolicyUnavailableDecision();
    expect(d.code).toBe('ASSORTMENT_UNRESOLVED');
    expect(d.purchasable).toBe(false);
  });
});
