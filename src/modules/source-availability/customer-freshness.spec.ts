import {
  isFreshExternalCommercialData,
  isFreshShowcaseDiscount,
} from './customer-freshness';

describe('customer commercial freshness', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const fresh = {
    supplyType: 'external_source',
    sourceAvailability: 'available',
    sourceSyncStatus: 'fresh',
    availabilityLastConfirmedAt: new Date(now - 60_000),
  };

  it('accepts only recently verified available external products for purchase', () => {
    expect(isFreshExternalCommercialData(fresh, now)).toBe(true);
    expect(isFreshExternalCommercialData({ ...fresh, sourceAvailability: 'unknown' }, now)).toBe(false);
    expect(isFreshExternalCommercialData({ ...fresh, sourceSyncStatus: 'source_error' }, now)).toBe(false);
    expect(isFreshExternalCommercialData({ ...fresh, availabilityLastConfirmedAt: null }, now)).toBe(false);
    expect(isFreshExternalCommercialData({ ...fresh, availabilityLastConfirmedAt: new Date(now - 5 * 60_000) }, now)).toBe(false);
  });

  it('allows showcase discounts only within the two-hour verification window', () => {
    expect(isFreshShowcaseDiscount(fresh, now)).toBe(true);
    expect(isFreshShowcaseDiscount({ ...fresh, availabilityLastConfirmedAt: new Date(now - 2 * 60 * 60_000) }, now)).toBe(false);
  });

  it('leaves internal inventory freshness behavior unchanged', () => {
    expect(isFreshExternalCommercialData({ supplyType: 'internal_stock' }, now)).toBe(true);
  });
});
