import {
  isCustomerPasteImportAuthorized,
  isUncuratedExternalPurchase,
  UNCURATED_EXTERNAL_PURCHASE_MESSAGE,
} from './external-purchase-eligibility';
import { evaluateDiscoveryEligibility } from './discovery-eligibility';
import {
  ProductCatalogOrigin,
  ProductSupplyType,
} from '../catalog-lifecycle/catalog-lifecycle.types';
import { membershipPatchForCustomerImportSuccess } from '../catalog-lifecycle/catalog-membership.util';

describe('external purchase eligibility (paste vs showcase)', () => {
  it('allows fresh customer-imported products outside curated showcase', () => {
    expect(
      isUncuratedExternalPurchase({
        supplyType: 'external_source',
        isCuratedExternalCatalog: false,
        catalogOrigin: ProductCatalogOrigin.external_on_demand,
      }),
    ).toBe(false);
    expect(
      isCustomerPasteImportAuthorized({
        catalogOrigin: ProductCatalogOrigin.external_on_demand,
      }),
    ).toBe(true);
  });

  it('blocks historical uncurated products without paste-link provenance', () => {
    expect(
      isUncuratedExternalPurchase({
        supplyType: 'external_source',
        isCuratedExternalCatalog: false,
      }),
    ).toBe(true);
    expect(
      isUncuratedExternalPurchase({
        supplyType: 'external_source',
        isCuratedExternalCatalog: 0,
        catalogOrigin: ProductCatalogOrigin.external_curated,
      }),
    ).toBe(true);
    expect(
      isUncuratedExternalPurchase({
        supplyType: 'external_source',
        isCuratedExternalCatalog: false,
        catalogOrigin: ProductCatalogOrigin.native_marketplace,
      }),
    ).toBe(true);
  });

  it('allows curated external products and native products', () => {
    expect(
      isUncuratedExternalPurchase({
        supplyType: 'external_source',
        isCuratedExternalCatalog: true,
      }),
    ).toBe(false);
    expect(
      isUncuratedExternalPurchase({
        supplyType: 'native_marketplace',
        isCuratedExternalCatalog: false,
      }),
    ).toBe(false);
    expect(isUncuratedExternalPurchase(undefined)).toBe(false);
  });

  it('customer import patch stamps on-demand provenance without curated promotion', () => {
    const patch = membershipPatchForCustomerImportSuccess();
    expect(patch.catalogOrigin).toBe(ProductCatalogOrigin.external_on_demand);
    expect(patch.supplyType).toBe(ProductSupplyType.external_source);
    expect(patch).not.toHaveProperty('isCuratedExternalCatalog');

    const created = {
      supplyType: ProductSupplyType.unclassified,
      isCuratedExternalCatalog: false,
    };
    const after = { ...created, ...patch };
    expect(after.isCuratedExternalCatalog).toBe(false);
    expect(
      isUncuratedExternalPurchase({
        supplyType: after.supplyType,
        isCuratedExternalCatalog: after.isCuratedExternalCatalog,
        catalogOrigin: after.catalogOrigin,
      }),
    ).toBe(false);
  });

  it('keeps uncurated paste imports out of public discovery', () => {
    const decision = evaluateDiscoveryEligibility({
      supplyType: ProductSupplyType.external_source,
      isCuratedExternalCatalog: false,
      sourceAvailability: 'available',
      status: 'active',
      isDeleted: false,
      price: 100,
      isSellable: true,
      hasStock: true,
      quantity: -1,
    });
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe('not_curated_external');
    expect(UNCURATED_EXTERNAL_PURCHASE_MESSAGE).toContain('بررسی');
  });
});
