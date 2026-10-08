import {
  applyDiscoveryEligibilityFilters,
  discoveryEligibilitySql,
  discoveryPurchasableSql,
  discoveryStockExclusion,
  evaluateDiscoveryEligibility,
  listingCardAvailableFromSourceAvailability,
} from './discovery-eligibility';
import { ProductSupplyType } from '../catalog-lifecycle/catalog-lifecycle.types';
import {
  SourceCommercialAvailability,
  SourceSyncStatus,
} from '../source-availability';

describe('discovery eligibility A4', () => {
  const curatedExternal = {
    supplyType: ProductSupplyType.external_source,
    isCuratedExternalCatalog: true,
    sourceAvailability: SourceCommercialAvailability.available,
    status: 'active',
    isDeleted: false,
    categoryId: 10,
    price: 100,
  };

  it('external + curated + available → discoverable', () => {
    expect(evaluateDiscoveryEligibility(curatedExternal).eligible).toBe(true);
  });

  it('external + curated + unknown → discoverable', () => {
    expect(
      evaluateDiscoveryEligibility({
        ...curatedExternal,
        sourceAvailability: SourceCommercialAvailability.unknown,
      }).eligible,
    ).toBe(true);
  });

  it('external + curated + available + source_error context → discoverable', () => {
    // sync health is not an input to discovery; commercial available wins
    const decision = evaluateDiscoveryEligibility({
      ...curatedExternal,
      sourceAvailability: SourceCommercialAvailability.available,
    });
    expect(decision.eligible).toBe(true);
    expect(SourceSyncStatus.source_error).toBe('source_error');
  });

  it('external + curated + unknown remains discoverable (source_error irrelevant)', () => {
    expect(
      evaluateDiscoveryEligibility({
        ...curatedExternal,
        sourceAvailability: SourceCommercialAvailability.unknown,
      }).eligible,
    ).toBe(true);
  });

  it('external + curated + unavailable → excluded', () => {
    const d = evaluateDiscoveryEligibility({
      ...curatedExternal,
      sourceAvailability: SourceCommercialAvailability.unavailable,
    });
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe('confirmed_unavailable');
  });

  it('external + curated + removed → excluded', () => {
    const d = evaluateDiscoveryEligibility({
      ...curatedExternal,
      sourceAvailability: SourceCommercialAvailability.removed,
    });
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe('removed');
  });

  it('external + NOT curated + available → excluded from discovery', () => {
    const d = evaluateDiscoveryEligibility({
      ...curatedExternal,
      isCuratedExternalCatalog: false,
      sourceAvailability: SourceCommercialAvailability.available,
    });
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe('not_curated_external');
  });

  it('external + NOT curated + unknown → excluded from discovery', () => {
    expect(
      evaluateDiscoveryEligibility({
        ...curatedExternal,
        isCuratedExternalCatalog: false,
        sourceAvailability: SourceCommercialAvailability.unknown,
      }).eligible,
    ).toBe(false);
  });

  it('native marketplace remains discoverable without source confirmation', () => {
    expect(
      evaluateDiscoveryEligibility({
        supplyType: ProductSupplyType.native_marketplace,
        isCuratedExternalCatalog: false,
        sourceAvailability: SourceCommercialAvailability.unknown,
        status: 'active',
        isDeleted: false,
        categoryId: 10,
        price: 50,
      }).eligible,
    ).toBe(true);
  });

  it('unclassified remains compatible for discovery', () => {
    expect(
      evaluateDiscoveryEligibility({
        supplyType: ProductSupplyType.unclassified,
        isCuratedExternalCatalog: false,
        sourceAvailability: SourceCommercialAvailability.unknown,
        status: 'active',
        isDeleted: false,
        categoryId: 10,
        price: 50,
      }).eligible,
    ).toBe(true);
  });

  it('listing card available: unknown is not sold-out; unavailable is false', () => {
    expect(
      listingCardAvailableFromSourceAvailability(
        SourceCommercialAvailability.available,
      ),
    ).toBe(true);
    expect(
      listingCardAvailableFromSourceAvailability(
        SourceCommercialAvailability.unknown,
      ),
    ).toBe(true);
    expect(
      listingCardAvailableFromSourceAvailability(
        SourceCommercialAvailability.unavailable,
      ),
    ).toBe(false);
    expect(
      listingCardAvailableFromSourceAvailability(
        SourceCommercialAvailability.removed,
      ),
    ).toBe(false);
  });

  it('SQL fragment excludes unavailable/removed curated externals and non-curated', () => {
    const sql = discoveryEligibilitySql('product');
    expect(sql).toContain("supplyType = 'external_source'");
    expect(sql).toContain('isCuratedExternalCatalog = 1');
    expect(sql).toContain("'unavailable'");
    expect(sql).toContain("'removed'");
    expect(sql).toContain("supplyType = 'native_marketplace'");
    expect(sql).toContain("supplyType = 'unclassified'");
  });

  describe('stock gate (Pass #2)', () => {
    it('hasStock=false external → not_purchasable', () => {
      const d = evaluateDiscoveryEligibility({
        ...curatedExternal,
        hasStock: false,
      });
      expect(d).toEqual(
        expect.objectContaining({
          eligible: false,
          reason: 'not_purchasable',
          detail: 'hasStock_false',
        }),
      );
    });

    it('isSellable=false → not_purchasable', () => {
      const d = evaluateDiscoveryEligibility({
        ...curatedExternal,
        isSellable: false,
      });
      expect(d.reason).toBe('not_purchasable');
      expect(d.detail).toBe('isSellable_false');
    });

    it('quantity=0 → not_purchasable; quantity=-1 (untracked) stays discoverable', () => {
      expect(
        evaluateDiscoveryEligibility({ ...curatedExternal, quantity: 0 })
          .reason,
      ).toBe('not_purchasable');
      expect(
        evaluateDiscoveryEligibility({
          ...curatedExternal,
          quantity: -1,
          hasStock: true,
          isSellable: true,
        }).eligible,
      ).toBe(true);
    });

    it('native marketplace ignores stale hasStock but honours quantity', () => {
      const native = {
        supplyType: ProductSupplyType.native_marketplace,
        isCuratedExternalCatalog: false,
        sourceAvailability: SourceCommercialAvailability.unknown,
        status: 'active',
        isDeleted: false,
        categoryId: 10,
        price: 50,
        isSellable: true,
      };
      expect(
        evaluateDiscoveryEligibility({
          ...native,
          hasStock: false,
          quantity: 5,
        }).eligible,
      ).toBe(true);
      expect(
        evaluateDiscoveryEligibility({ ...native, hasStock: true, quantity: 0 })
          .eligible,
      ).toBe(false);
    });

    it('SQL fragment ANDs the stock gate into discovery membership', () => {
      const sql = discoveryEligibilitySql('product').replace(/\s+/g, ' ');
      expect(sql).toContain('AND ( product.isSellable = 1');
      expect(sql).toContain('product.quantity <> 0');
      expect(sql).toContain(
        "( product.hasStock = 1 OR product.supplyType = 'native_marketplace' )",
      );
    });

    it('stock gate respects the alias', () => {
      const sql = discoveryPurchasableSql('p');
      expect(sql).toContain('p.isSellable = 1');
      expect(sql).toContain('p.hasStock = 1');
      expect(sql).not.toContain('product.');
    });

    it('discoveryStockExclusion mirrors the SQL gate, incl. raw 0/1 flags', () => {
      expect(
        discoveryStockExclusion({
          supplyType: 'external_source',
          hasStock: 0,
          isSellable: 1,
          quantity: -1,
        }),
      ).toBe('hasStock_false');
      expect(
        discoveryStockExclusion({
          supplyType: 'external_source',
          hasStock: 1,
          isSellable: 0,
          quantity: -1,
        }),
      ).toBe('isSellable_false');
      expect(
        discoveryStockExclusion({
          supplyType: 'native_marketplace',
          hasStock: 0,
          isSellable: 1,
          quantity: 2,
        }),
      ).toBeNull();
      expect(
        discoveryStockExclusion({
          supplyType: 'native_marketplace',
          hasStock: 1,
          isSellable: 1,
          quantity: '0',
        }),
      ).toBe('quantity_zero');
    });

    it('missing stock fields are no evidence, never unavailable', () => {
      expect(discoveryStockExclusion({})).toBeNull();
      expect(
        discoveryStockExclusion({
          hasStock: null,
          isSellable: null,
          quantity: null,
        }),
      ).toBeNull();
    });
  });

  it('UNKNOWN sourceAvailability with purchasable stock stays discoverable', () => {
    expect(
      evaluateDiscoveryEligibility({
        ...curatedExternal,
        sourceAvailability: SourceCommercialAvailability.unknown,
        hasStock: true,
        isSellable: true,
        quantity: -1,
      }).eligible,
    ).toBe(true);
  });

  it('applyDiscoveryEligibilityFilters andWhere on builder', () => {
    const calls: string[] = [];
    const builder = {
      andWhere(sql: string) {
        calls.push(sql);
        return builder;
      },
    };
    applyDiscoveryEligibilityFilters(builder as any, 'product');
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('isCuratedExternalCatalog = 1');
  });
});
