import { resolveCartLineConfig } from './cart-line.resolve';

describe('resolveCartLineConfig external freshness gate', () => {
  const product: any = {
    id: 7, name: 'external', price: 100, discountedPrice: 80, quantity: 4,
    isSellable: true, isDeleted: false, status: 'active', categoryId: 2,
    supplyType: 'external_source', sourceAvailability: 'available',
    sourceSyncStatus: 'fresh', availabilityLastConfirmedAt: new Date(),
    productAttributeValues: [],
  };

  it.each([
    { sourceAvailability: 'unknown', sourceSyncStatus: 'never_verified', availabilityLastConfirmedAt: null },
    { sourceAvailability: 'unavailable', sourceSyncStatus: 'fresh' },
    { sourceAvailability: 'available', sourceSyncStatus: 'source_error' },
    { sourceAvailability: 'available', sourceSyncStatus: 'fresh', availabilityLastConfirmedAt: new Date(Date.now() - 6 * 60_000) },
  ])('blocks stale or non-authoritative source state %#', (freshness) => {
    const result = resolveCartLineConfig({ product: { ...product, ...freshness }, quantity: 1, tryToToman: 1 });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('source_verification_required');
  });

  it('allows a recently verified available external product', () => {
    const result = resolveCartLineConfig({ product, quantity: 1, tryToToman: 1 });
    expect(result.ok).toBe(true);
  });
});
