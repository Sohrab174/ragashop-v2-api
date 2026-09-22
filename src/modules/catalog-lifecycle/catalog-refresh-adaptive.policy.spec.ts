import {
  assertUserImportOutranksCatalogBands,
  calculateBackgroundRefreshPriority,
  compareAdaptiveRefreshCandidates,
  isCurrentlyDiscounted,
} from './catalog-refresh-adaptive.policy';
import {
  MarketplaceImportJobPriorityBand,
  ProductSupplyType,
} from './catalog-lifecycle.types';
import {
  SourceCommercialAvailability,
  SourceSyncStatus,
} from '../source-availability';
import { loadCatalogLifecycleRuntimeConfig } from './catalog-lifecycle.config';
import { isRealSale } from '../catalog/storefront-plp.pricing';
import { applyStorefrontDiscountDiscoveryFilter } from '../catalog/storefront-plp.query';
import { evaluateDiscoveryEligibility } from '../product/discovery-eligibility';

describe('A5 adaptive catalog refresh policy', () => {
  const config = loadCatalogLifecycleRuntimeConfig();
  const now = new Date('2026-09-21T12:00:00.000Z');

  const base = {
    id: 1,
    source: 'trendyol',
    sourceId: '111',
    sourceUrl: '/x-p-111',
    supplyType: ProductSupplyType.external_source,
    isCuratedExternalCatalog: true,
    sourceAvailability: SourceCommercialAvailability.available,
    sourceSyncStatus: SourceSyncStatus.fresh,
    availabilityLastConfirmedAt: new Date('2026-09-01T00:00:00.000Z'),
    sourceLastAttemptAt: null as Date | null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    price: 4000,
    discountedPrice: 0,
    hasRecentCartDemand: false,
  };

  it('1 curated external Product eligible when past cold TTL', () => {
    const decision = calculateBackgroundRefreshPriority(base, { now, config });
    expect(decision.eligible).toBe(true);
    expect(decision.tier).toBe('COLD');
  });

  it('2 non-curated external Product excluded', () => {
    const decision = calculateBackgroundRefreshPriority(
      { ...base, isCuratedExternalCatalog: false },
      { now, config },
    );
    expect(decision.eligible).toBe(false);
    expect(decision.detail).toContain('excluded_not_curated_external');
  });

  it('3 native marketplace Product excluded', () => {
    const decision = calculateBackgroundRefreshPriority(
      {
        ...base,
        supplyType: ProductSupplyType.native_marketplace,
        isCuratedExternalCatalog: false,
      },
      { now, config },
    );
    expect(decision.eligible).toBe(false);
  });

  it('4 REMOVED excluded from recurring refresh', () => {
    const decision = calculateBackgroundRefreshPriority(
      {
        ...base,
        sourceAvailability: SourceCommercialAvailability.removed,
      },
      { now, config },
    );
    expect(decision.eligible).toBe(false);
    expect(decision.detail).toContain('removed');
  });

  it('7 high-priority discounted candidate outranks cold candidate', () => {
    const hot = calculateBackgroundRefreshPriority(
      {
        ...base,
        id: 2,
        discountedPrice: 2500,
        availabilityLastConfirmedAt: new Date('2026-09-18T00:00:00.000Z'),
      },
      { now, config },
    );
    const cold = calculateBackgroundRefreshPriority(base, { now, config });
    expect(hot.eligible).toBe(true);
    expect(hot.priorityClass).toBe('COMMERCE_PRIORITY');
    expect(hot.priority).toBeGreaterThan(cold.priority);
    const ordered = [
      { product: { ...base, id: 1 }, decision: cold },
      {
        product: { ...base, id: 2, discountedPrice: 2500 },
        decision: hot,
      },
    ].sort(compareAdaptiveRefreshCandidates);
    expect(ordered[0].product.id).toBe(2);
  });

  it('8 USER_IMPORT remains higher priority than background commerce', () => {
    expect(assertUserImportOutranksCatalogBands()).toBe(true);
    expect(MarketplaceImportJobPriorityBand.USER_IMPORT).toBeGreaterThan(
      MarketplaceImportJobPriorityBand.COMMERCE_PRIORITY,
    );
  });

  it('Fix#3 UNKNOWN + SOURCE_ERROR + lastAttempt=now is NOT immediately eligible', () => {
    const decision = calculateBackgroundRefreshPriority(
      {
        ...base,
        sourceAvailability: SourceCommercialAvailability.unknown,
        sourceSyncStatus: SourceSyncStatus.source_error,
        sourceLastAttemptAt: now,
      },
      { now, config },
    );
    expect(decision.eligible).toBe(false);
    expect(decision.detail).toBe('source_error_in_cooldown');
  });

  it('Fix#3 UNKNOWN + SOURCE_ERROR + cooldown elapsed is eligible', () => {
    const decision = calculateBackgroundRefreshPriority(
      {
        ...base,
        sourceAvailability: SourceCommercialAvailability.unknown,
        sourceSyncStatus: SourceSyncStatus.source_error,
        sourceLastAttemptAt: new Date('2026-09-20T00:00:00.000Z'),
      },
      { now, config },
    );
    expect(decision.eligible).toBe(true);
    expect(decision.reason).toBe('source_error_recheck');
  });

  it('Fix#3 UNKNOWN + NEVER_VERIFIED follows initial verification', () => {
    const decision = calculateBackgroundRefreshPriority(
      {
        ...base,
        sourceAvailability: SourceCommercialAvailability.unknown,
        sourceSyncStatus: SourceSyncStatus.never_verified,
        sourceLastAttemptAt: null,
        availabilityLastConfirmedAt: null,
      },
      { now, config },
    );
    expect(decision.eligible).toBe(true);
    expect(decision.reason).toBe('never_verified');
  });

  it('Fix#3 UNKNOWN without recent error follows UNKNOWN policy', () => {
    const decision = calculateBackgroundRefreshPriority(
      {
        ...base,
        sourceAvailability: SourceCommercialAvailability.unknown,
        sourceSyncStatus: SourceSyncStatus.fresh,
        sourceLastAttemptAt: null,
      },
      { now, config },
    );
    expect(decision.eligible).toBe(true);
    expect(decision.reason).toBe('unknown_availability');
  });

  it('Fix#3 AVAILABLE + SOURCE_ERROR respects cooldown', () => {
    const cooling = calculateBackgroundRefreshPriority(
      {
        ...base,
        sourceAvailability: SourceCommercialAvailability.available,
        sourceSyncStatus: SourceSyncStatus.source_error,
        sourceLastAttemptAt: now,
      },
      { now, config },
    );
    expect(cooling.eligible).toBe(false);

    const ready = calculateBackgroundRefreshPriority(
      {
        ...base,
        sourceAvailability: SourceCommercialAvailability.available,
        sourceSyncStatus: SourceSyncStatus.source_error,
        sourceLastAttemptAt: new Date('2026-09-20T00:00:00.000Z'),
      },
      { now, config },
    );
    expect(ready.eligible).toBe(true);
    expect(ready.reason).toBe('source_error_recheck');
  });

  it('Fix#3 UNAVAILABLE + SOURCE_ERROR prevents retry storm via cooldown', () => {
    const decision = calculateBackgroundRefreshPriority(
      {
        ...base,
        sourceAvailability: SourceCommercialAvailability.unavailable,
        sourceSyncStatus: SourceSyncStatus.source_error,
        sourceLastAttemptAt: now,
        availabilityLastConfirmedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      { now, config },
    );
    expect(decision.eligible).toBe(false);
    expect(decision.detail).toBe('source_error_in_cooldown');
  });

  it('discounted product uses HOT cadence and stays fresh inside hot TTL', () => {
    const freshHot = calculateBackgroundRefreshPriority(
      {
        ...base,
        discountedPrice: 2500,
        availabilityLastConfirmedAt: now,
      },
      { now, config },
    );
    expect(freshHot.eligible).toBe(false);
    expect(freshHot.detail).toBe('available_fresh_hot');

    const staleHot = calculateBackgroundRefreshPriority(
      {
        ...base,
        discountedPrice: 2500,
        availabilityLastConfirmedAt: new Date('2026-09-18T00:00:00.000Z'),
      },
      { now, config },
    );
    expect(staleHot.eligible).toBe(true);
    expect(staleHot.reason).toBe('available_stale_discount');
    expect(staleHot.tier).toBe('HOT');
  });

  it('cart demand uses WARM cadence', () => {
    const warm = calculateBackgroundRefreshPriority(
      {
        ...base,
        hasRecentCartDemand: true,
        availabilityLastConfirmedAt: new Date('2026-09-16T00:00:00.000Z'),
      },
      { now, config },
    );
    expect(warm.eligible).toBe(true);
    expect(warm.tier).toBe('WARM');
    expect(warm.priorityClass).toBe('CATALOG_HIGH');
  });

  it('12-18 discount correctness predicates', () => {
    expect(isCurrentlyDiscounted({ price: 4000, discountedPrice: 2500 })).toBe(
      true,
    );
    expect(isRealSale(4000, 2500)).toBe(true);
    expect(isRealSale(4000, 3200)).toBe(true);
    expect(isRealSale(4000, 4000)).toBe(false);
    expect(isRealSale(4000, 0)).toBe(false);
    expect(isRealSale(4000, null)).toBe(false);
    expect(isCurrentlyDiscounted({ price: 4000, discountedPrice: 0 })).toBe(
      false,
    );
  });

  it('25-27 discount discovery filter + A4 eligibility', () => {
    const andWhere = jest.fn();
    applyStorefrontDiscountDiscoveryFilter({ andWhere });
    expect(andWhere).toHaveBeenCalled();
    const sql = String(andWhere.mock.calls[0][0]);
    expect(sql).toContain('discountedPrice < product.price');
    expect(sql).toContain('discountedPrice > 0');

    const endedDiscountStillCatalog = evaluateDiscoveryEligibility({
      supplyType: ProductSupplyType.external_source,
      isCuratedExternalCatalog: true,
      sourceAvailability: SourceCommercialAvailability.available,
      status: 'active',
      isDeleted: false,
      categoryId: 10,
      price: 4000,
    });
    expect(endedDiscountStillCatalog.eligible).toBe(true);

    const pasteLink = evaluateDiscoveryEligibility({
      supplyType: ProductSupplyType.external_source,
      isCuratedExternalCatalog: false,
      sourceAvailability: SourceCommercialAvailability.available,
      status: 'active',
      isDeleted: false,
      categoryId: 10,
      price: 4000,
    });
    expect(pasteLink.eligible).toBe(false);

    const unavailable = evaluateDiscoveryEligibility({
      supplyType: ProductSupplyType.external_source,
      isCuratedExternalCatalog: true,
      sourceAvailability: SourceCommercialAvailability.unavailable,
      status: 'active',
      isDeleted: false,
      categoryId: 10,
      price: 4000,
    });
    expect(unavailable.eligible).toBe(false);
  });
});
