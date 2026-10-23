import {
  isUncuratedExternalPurchase,
  UNCURATED_EXTERNAL_PURCHASE_MESSAGE,
} from './external-purchase-eligibility';
import { evaluateDiscoveryEligibility } from './discovery-eligibility';
import { ProductSupplyType } from '../catalog-lifecycle/catalog-lifecycle.types';

describe('uncurated external purchase gate', () => {
  it('blocks purchase of external products before catalog approval', () => {
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

  it('keeps uncurated external products out of public discovery', () => {
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
