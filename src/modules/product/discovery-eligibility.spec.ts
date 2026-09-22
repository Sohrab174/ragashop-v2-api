import {
  applyDiscoveryEligibilityFilters,
  discoveryEligibilitySql,
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
