import {
  isFreshExternalCommercialData,
  isFreshShowcaseDiscount,
  isFreshShowcaseListing,
  resolveDiscountDisplayExpiresAt,
  resolveShowcaseDiscountFreshnessMs,
  SHOWCASE_DISCOUNT_FRESHNESS_MS,
  SHOWCASE_LISTING_FRESHNESS_MS,
} from './customer-freshness';

describe('customer commercial freshness', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const fresh = {
    supplyType: 'external_source',
    sourceAvailability: 'available',
    sourceSyncStatus: 'fresh',
    availabilityLastConfirmedAt: new Date(now - 60_000),
  };

  const prevDiscountTtl = process.env.SHOWCASE_DISCOUNT_FRESHNESS_MS;
  afterEach(() => {
    if (prevDiscountTtl === undefined) {
      delete process.env.SHOWCASE_DISCOUNT_FRESHNESS_MS;
    } else {
      process.env.SHOWCASE_DISCOUNT_FRESHNESS_MS = prevDiscountTtl;
    }
  });

  it('accepts only recently verified available external products for purchase', () => {
    expect(isFreshExternalCommercialData(fresh, now)).toBe(true);
    expect(
      isFreshExternalCommercialData(
        { ...fresh, sourceAvailability: 'unknown' },
        now,
      ),
    ).toBe(false);
    expect(
      isFreshExternalCommercialData(
        { ...fresh, sourceSyncStatus: 'source_error' },
        now,
      ),
    ).toBe(false);
    expect(
      isFreshExternalCommercialData(
        { ...fresh, availabilityLastConfirmedAt: null },
        now,
      ),
    ).toBe(false);
    expect(
      isFreshExternalCommercialData(
        {
          ...fresh,
          availabilityLastConfirmedAt: new Date(now - 5 * 60_000),
        },
        now,
      ),
    ).toBe(false);
  });

  it('allows showcase discounts within the 24-hour verification window by default', () => {
    expect(SHOWCASE_DISCOUNT_FRESHNESS_MS).toBe(24 * 60 * 60 * 1000);
    expect(isFreshShowcaseDiscount(fresh, now)).toBe(true);
    expect(
      isFreshShowcaseDiscount(
        {
          ...fresh,
          availabilityLastConfirmedAt: new Date(now - 12 * 60 * 60_000),
        },
        now,
      ),
    ).toBe(true);
    expect(
      isFreshShowcaseDiscount(
        {
          ...fresh,
          availabilityLastConfirmedAt: new Date(now - 24 * 60 * 60_000),
        },
        now,
      ),
    ).toBe(false);
  });

  it('honors an earlier discountDisplayExpiresAt (Flash window)', () => {
    expect(
      isFreshShowcaseDiscount(
        {
          ...fresh,
          discountDisplayExpiresAt: new Date(now + 60_000),
        },
        now,
      ),
    ).toBe(true);
    expect(
      isFreshShowcaseDiscount(
        {
          ...fresh,
          discountDisplayExpiresAt: new Date(now - 1),
        },
        now,
      ),
    ).toBe(false);
  });

  it('does not resurrect an expired Flash deadline via 24h fallback when deadline is preserved', () => {
    // confirmation still within 24h, but authoritative Flash end has passed
    const stillWithin24h = {
      ...fresh,
      availabilityLastConfirmedAt: new Date(now - 60_000),
      discountDisplayExpiresAt: new Date(now - 1),
    };
    expect(isFreshShowcaseDiscount(stillWithin24h, now)).toBe(false);
    // Clearing the deadline would incorrectly restore the 24h fallback — forbidden.
    expect(
      isFreshShowcaseDiscount(
        { ...stillWithin24h, discountDisplayExpiresAt: null },
        now,
      ),
    ).toBe(true);
  });

  it('resolves display expiry as min(ttl, campaign end)', () => {
    const confirmed = new Date(now);
    const campaignEnd = new Date(now + 6 * 60 * 60_000);
    const expires = resolveDiscountDisplayExpiresAt(
      confirmed,
      campaignEnd,
      24 * 60 * 60_000,
    );
    expect(expires?.getTime()).toBe(campaignEnd.getTime());
  });

  it('allows env override for discount freshness', () => {
    process.env.SHOWCASE_DISCOUNT_FRESHNESS_MS = String(2 * 60 * 60_000);
    expect(resolveShowcaseDiscountFreshnessMs()).toBe(2 * 60 * 60_000);
  });

  it('allows showcase listing within the longer listing TTL without changing purchase/discount windows', () => {
    expect(SHOWCASE_LISTING_FRESHNESS_MS).toBe(2 * 24 * 60 * 60 * 1000);
    expect(
      isFreshShowcaseListing(
        {
          ...fresh,
          availabilityLastConfirmedAt: new Date(now - 12 * 60 * 60_000),
        },
        now,
      ),
    ).toBe(true);
    expect(isFreshExternalCommercialData(fresh, now, 5 * 60_000)).toBe(true);
    expect(
      isFreshShowcaseListing(
        {
          ...fresh,
          availabilityLastConfirmedAt: new Date(
            now - SHOWCASE_LISTING_FRESHNESS_MS,
          ),
        },
        now,
      ),
    ).toBe(false);
  });

  it('leaves internal inventory freshness behavior unchanged', () => {
    expect(
      isFreshExternalCommercialData({ supplyType: 'internal_stock' }, now),
    ).toBe(true);
  });
});
