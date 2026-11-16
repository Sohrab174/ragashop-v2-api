import {
  SHOWCASE_VERIFIED_DISCOVERY_ENV,
  applyDiscoveryEligibilityFilters,
  discoveryEligibilitySql,
  discoveryPurchasableSql,
  discoveryStockExclusion,
  evaluateDiscoveryEligibility,
  isShowcaseVerifiedDiscoveryEnabled,
  listingCardAvailableFromSourceAvailability,
} from './discovery-eligibility';
import { ProductSupplyType } from '../catalog-lifecycle/catalog-lifecycle.types';
import {
  SourceCommercialAvailability,
  SourceSyncStatus,
} from '../source-availability';
import { isUncuratedExternalPurchase } from './external-purchase-eligibility';
import { ProductCatalogOrigin } from '../catalog-lifecycle/catalog-lifecycle.types';
import { isRealSale } from '../catalog/storefront-plp.pricing';
import { isFreshShowcaseDiscount } from '../source-availability/customer-freshness';

function withEnv(key: string, value: string | undefined, run: () => void) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    run();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

describe('discovery eligibility A4 — verified showcase', () => {
  const now = Date.parse('2026-11-15T12:00:00.000Z');
  const freshAt = new Date(now - 30 * 60_000);

  const curatedVerified = {
    supplyType: ProductSupplyType.external_source,
    isCuratedExternalCatalog: true,
    sourceAvailability: SourceCommercialAvailability.available,
    sourceSyncStatus: SourceSyncStatus.fresh,
    availabilityLastConfirmedAt: freshAt,
    coverId: 99,
    status: 'active',
    isDeleted: false,
    categoryId: 17,
    price: 100,
    hasStock: true,
    isSellable: true,
    quantity: -1,
  };

  it('flag defaults to verified discovery enabled', () => {
    withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, undefined, () => {
      expect(isShowcaseVerifiedDiscoveryEnabled()).toBe(true);
    });
  });

  it('verified curated product → visible', () => {
    withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '1', () => {
      expect(evaluateDiscoveryEligibility(curatedVerified, now).eligible).toBe(
        true,
      );
    });
  });

  it('stale curated product → still listable in ordinary showcase (not confirmed available)', () => {
    withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '1', () => {
      const stale = {
        ...curatedVerified,
        availabilityLastConfirmedAt: new Date(now - 3 * 24 * 60 * 60_000),
      };
      const d = evaluateDiscoveryEligibility(stale, now);
      expect(d.eligible).toBe(true);
      expect(
        listingCardAvailableFromSourceAvailability(stale.sourceAvailability, {
          supplyType: stale.supplyType,
          sourceSyncStatus: stale.sourceSyncStatus,
          availabilityLastConfirmedAt: stale.availabilityLastConfirmedAt,
          now,
        }),
      ).toBe(false);
    });
  });

  it('unknown / never_verified product → listable but not confirmed available', () => {
    withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '1', () => {
      const unknown = {
        ...curatedVerified,
        sourceAvailability: SourceCommercialAvailability.unknown,
        sourceSyncStatus: SourceSyncStatus.never_verified,
        availabilityLastConfirmedAt: null,
      };
      expect(evaluateDiscoveryEligibility(unknown, now).eligible).toBe(true);
      expect(
        listingCardAvailableFromSourceAvailability(unknown.sourceAvailability, {
          supplyType: unknown.supplyType,
          sourceSyncStatus: unknown.sourceSyncStatus,
          availabilityLastConfirmedAt: null,
          now,
        }),
      ).toBe(false);
    });
  });

  it('source_error after failed refresh → listable but not confirmed available', () => {
    withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '1', () => {
      const errored = {
        ...curatedVerified,
        sourceSyncStatus: SourceSyncStatus.source_error,
      };
      expect(evaluateDiscoveryEligibility(errored, now).eligible).toBe(true);
      expect(
        listingCardAvailableFromSourceAvailability(
          errored.sourceAvailability,
          {
            supplyType: errored.supplyType,
            sourceSyncStatus: errored.sourceSyncStatus,
            availabilityLastConfirmedAt: errored.availabilityLastConfirmedAt,
            now,
          },
        ),
      ).toBe(false);
    });
  });

  it('ordinary showcase may list curated product even when variants are all qty 0', () => {
    withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '1', () => {
      const d = evaluateDiscoveryEligibility(
        {
          ...curatedVerified,
          hasVariants: true,
          hasPurchasableVariant: false,
        },
        now,
      );
      expect(d.eligible).toBe(true);
    });
  });

  it('missing cover image → excluded from verified showcase', () => {
    withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '1', () => {
      expect(
        evaluateDiscoveryEligibility(
          { ...curatedVerified, coverId: null },
          now,
        ).reason,
      ).toBe('missing_image');
    });
  });

  it('bulky category → excluded from verified showcase', () => {
    withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '1', () => {
      expect(
        evaluateDiscoveryEligibility(
          { ...curatedVerified, categoryId: 352 },
          now,
        ).reason,
      ).toBe('bulky_category');
    });
  });

  it('external + curated + unavailable → excluded', () => {
    withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '1', () => {
      const d = evaluateDiscoveryEligibility({
        ...curatedVerified,
        sourceAvailability: SourceCommercialAvailability.unavailable,
      });
      expect(d.eligible).toBe(false);
      expect(d.reason).toBe('confirmed_unavailable');
    });
  });

  it('external + curated + removed → excluded', () => {
    withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '1', () => {
      const d = evaluateDiscoveryEligibility({
        ...curatedVerified,
        sourceAvailability: SourceCommercialAvailability.removed,
      });
      expect(d.eligible).toBe(false);
      expect(d.reason).toBe('removed');
    });
  });

  it('customer-imported uncurated product → excluded from public showcase', () => {
    withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '1', () => {
      const d = evaluateDiscoveryEligibility({
        ...curatedVerified,
        isCuratedExternalCatalog: false,
      });
      expect(d.eligible).toBe(false);
      expect(d.reason).toBe('not_curated_external');
    });
  });

  it('customer-imported uncurated on-demand product stays purchase-eligible', () => {
    expect(
      isUncuratedExternalPurchase({
        supplyType: 'external_source',
        isCuratedExternalCatalog: false,
        catalogOrigin: ProductCatalogOrigin.external_on_demand,
      }),
    ).toBe(false);
  });

  it('genuine fresh discount → eligible for discount badge', () => {
    const product = {
      ...curatedVerified,
      price: 200,
      discountedPrice: 100,
      supplyType: 'external_source',
    };
    expect(isRealSale(product.price, product.discountedPrice)).toBe(true);
    expect(isFreshShowcaseDiscount(product, now)).toBe(true);
  });

  it('expired or invalid discount → excluded from sale badge', () => {
    expect(isRealSale(200, 200)).toBe(false);
    expect(isRealSale(200, 0)).toBe(false);
    expect(
      isFreshShowcaseDiscount(
        {
          ...curatedVerified,
          availabilityLastConfirmedAt: new Date(now - 25 * 60 * 60_000),
        },
        now,
      ),
    ).toBe(false);
  });

  it('native marketplace remains discoverable without source confirmation', () => {
    withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '1', () => {
      expect(
        evaluateDiscoveryEligibility({
          supplyType: ProductSupplyType.native_marketplace,
          isCuratedExternalCatalog: false,
          sourceAvailability: SourceCommercialAvailability.unknown,
          status: 'active',
          isDeleted: false,
          categoryId: 10,
          price: 50,
          isSellable: true,
          quantity: 5,
        }).eligible,
      ).toBe(true);
    });
  });

  it('legacy flag OFF restores unknown discoverable behavior', () => {
    withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '0', () => {
      expect(
        evaluateDiscoveryEligibility({
          supplyType: ProductSupplyType.external_source,
          isCuratedExternalCatalog: true,
          sourceAvailability: SourceCommercialAvailability.unknown,
          status: 'active',
          isDeleted: false,
          categoryId: 17,
          price: 100,
          hasStock: true,
          isSellable: true,
          quantity: -1,
        }).eligible,
      ).toBe(true);
    });
  });

  it('listing card available: verified mode rejects unknown for external', () => {
    withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '1', () => {
      expect(
        listingCardAvailableFromSourceAvailability(
          SourceCommercialAvailability.unknown,
          {
            supplyType: ProductSupplyType.external_source,
            sourceSyncStatus: SourceSyncStatus.never_verified,
            availabilityLastConfirmedAt: null,
            now,
          },
        ),
      ).toBe(false);
      expect(
        listingCardAvailableFromSourceAvailability(
          SourceCommercialAvailability.available,
          {
            supplyType: ProductSupplyType.external_source,
            sourceSyncStatus: SourceSyncStatus.fresh,
            availabilityLastConfirmedAt: freshAt,
            now,
          },
        ),
      ).toBe(true);
    });
  });

  it('SQL fragment under ordinary showcase requires cover and excludes unavailable/removed (not 48h fresh)', () => {
    withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '1', () => {
      const sql = discoveryEligibilitySql('product');
      expect(sql).toContain('coverId IS NOT NULL');
      expect(sql).toContain("sourceAvailability NOT IN");
      expect(sql).toContain("'unavailable'");
      expect(sql).toContain("'removed'");
      expect(sql).not.toContain("sourceAvailability = 'available'");
      expect(sql).not.toContain('availabilityLastConfirmedAt');
      expect(sql).not.toContain('product_attribute_value');
    });
  });

  describe('stock gate (Pass #2)', () => {
    it('hasStock=false external curated → still ordinary-showcase listable', () => {
      withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '1', () => {
        const d = evaluateDiscoveryEligibility({
          ...curatedVerified,
          hasStock: false,
        });
        expect(d.eligible).toBe(true);
        expect(
          listingCardAvailableFromSourceAvailability(
            SourceCommercialAvailability.available,
            {
              supplyType: ProductSupplyType.external_source,
              sourceSyncStatus: SourceSyncStatus.fresh,
              availabilityLastConfirmedAt: freshAt,
              now,
            },
          ) && discoveryStockExclusion({ hasStock: false, isSellable: true, quantity: -1, supplyType: 'external_source' }) === null,
        ).toBe(false);
      });
    });

    it('quantity=0 native → not_purchasable; external curated quantity=0 still listable', () => {
      withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '1', () => {
        expect(
          evaluateDiscoveryEligibility({
            supplyType: ProductSupplyType.native_marketplace,
            isCuratedExternalCatalog: false,
            sourceAvailability: SourceCommercialAvailability.unknown,
            status: 'active',
            isDeleted: false,
            categoryId: 10,
            price: 50,
            isSellable: true,
            quantity: 0,
          }).reason,
        ).toBe('not_purchasable');
        expect(
          evaluateDiscoveryEligibility(
            { ...curatedVerified, quantity: 0 },
            now,
          ).eligible,
        ).toBe(true);
      });
    });

    it('SQL fragment keeps stock gate for native/unclassified only', () => {
      const sql = discoveryEligibilitySql('product').replace(/\s+/g, ' ');
      expect(sql).toContain("supplyType = 'native_marketplace'");
      expect(sql).toContain('product.isSellable = 1');
      expect(sql).toContain('product.quantity <> 0');
    });

    it('stock gate respects the alias', () => {
      const sql = discoveryPurchasableSql('p');
      expect(sql).toContain('p.isSellable = 1');
      expect(sql).not.toContain('product.');
    });

    it('discoveryStockExclusion mirrors the SQL gate', () => {
      expect(
        discoveryStockExclusion({
          supplyType: 'external_source',
          hasStock: 0,
          isSellable: 1,
          quantity: -1,
        }),
      ).toBe('hasStock_false');
    });
  });

  it('applyDiscoveryEligibilityFilters andWhere on builder', () => {
    withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '1', () => {
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
      expect(calls[0]).toContain('coverId IS NOT NULL');
      expect(calls[0]).not.toContain("sourceSyncStatus = 'fresh'");
    });
  });

  it('stub category remains non-discoverable (taxonomy preserved)', () => {
    withEnv(SHOWCASE_VERIFIED_DISCOVERY_ENV, '1', () => {
      expect(
        evaluateDiscoveryEligibility({
          ...curatedVerified,
          categoryId: 1,
        }).reason,
      ).toBe('category_not_discoverable');
    });
  });
});
