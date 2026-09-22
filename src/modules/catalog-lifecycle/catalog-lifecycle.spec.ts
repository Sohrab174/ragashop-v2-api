import {
  assertUserImportOutranksCatalogBands,
  evaluateCatalogRefreshEligibility,
} from './catalog-refresh-eligibility';
import {
  MarketplaceImportJobPriorityBand,
  ProductSupplyType,
} from './catalog-lifecycle.types';
import {
  SourceCommercialAvailability,
  SourceSyncStatus,
} from '../source-availability';
import { loadCatalogLifecycleRuntimeConfig } from './catalog-lifecycle.config';
import { CatalogRefreshCircuitBreaker } from './catalog-refresh-circuit-breaker';
import { applySourceSyncFailure } from '../source-availability';
import { createInitialSourceAvailabilityProjection } from '../source-availability';
import { SourceSyncErrorCode } from '../source-availability';
import {
  isCuratedExternalMember,
  membershipPatchForCustomerImportSuccess,
  membershipPatchForScheduledImportSuccess,
  promoteExternalToCurated,
  retireExternalFromCurated,
} from './catalog-membership.util';

describe('catalog-lifecycle A3 Fix #1', () => {
  const config = loadCatalogLifecycleRuntimeConfig();
  const now = new Date('2026-09-12T12:00:00.000Z');

  const base = {
    id: 1,
    source: 'trendyol',
    sourceId: '111',
    sourceUrl: '/x-p-111',
    supplyType: ProductSupplyType.external_source,
    isCuratedExternalCatalog: true,
    sourceAvailability: SourceCommercialAvailability.unknown,
    sourceSyncStatus: SourceSyncStatus.never_verified,
    availabilityLastConfirmedAt: null as Date | null,
    sourceLastAttemptAt: null as Date | null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
  };

  it('user import priority > all background catalog refresh priorities', () => {
    expect(assertUserImportOutranksCatalogBands()).toBe(true);
    expect(MarketplaceImportJobPriorityBand.USER_IMPORT).toBe(100);
    expect(MarketplaceImportJobPriorityBand.USER_IMPORT).toBeGreaterThan(
      MarketplaceImportJobPriorityBand.CATALOG_HIGH,
    );
  });

  it('native marketplace product is never selected for external refresh', () => {
    const decision = evaluateCatalogRefreshEligibility(
      {
        ...base,
        supplyType: ProductSupplyType.native_marketplace,
        isCuratedExternalCatalog: false,
      },
      now,
      config,
    );
    expect(decision.eligible).toBe(false);
    expect(decision.detail).toContain('excluded_not_curated_external');
  });

  it('non-curated on-demand external is excluded from curated background refresh', () => {
    const decision = evaluateCatalogRefreshEligibility(
      {
        ...base,
        supplyType: ProductSupplyType.external_source,
        isCuratedExternalCatalog: false,
      },
      now,
      config,
    );
    expect(decision.eligible).toBe(false);
  });

  it('curated external is eligible according to normal A3 refresh rules', () => {
    const decision = evaluateCatalogRefreshEligibility(base, now, config);
    expect(decision.eligible).toBe(true);
    expect(decision.priorityClass).toBe('CATALOG_HIGH');
  });

  it('customer paste of curated product preserves curated membership', () => {
    const before = {
      supplyType: ProductSupplyType.external_source,
      isCuratedExternalCatalog: true,
    };
    const patch = membershipPatchForCustomerImportSuccess();
    const after = { ...before, ...patch };
    expect(after.isCuratedExternalCatalog).toBe(true);
    expect(after.supplyType).toBe(ProductSupplyType.external_source);
    expect(patch).not.toHaveProperty('isCuratedExternalCatalog');
  });

  it('new customer paste-link defaults to external + not curated', () => {
    const created = {
      supplyType: ProductSupplyType.unclassified,
      isCuratedExternalCatalog: false,
    };
    const after = { ...created, ...membershipPatchForCustomerImportSuccess() };
    expect(after.supplyType).toBe(ProductSupplyType.external_source);
    expect(after.isCuratedExternalCatalog).toBe(false);
  });

  it('non-curated external can later become curated', () => {
    const promoted = promoteExternalToCurated({
      supplyType: ProductSupplyType.external_source,
      isCuratedExternalCatalog: false,
    });
    expect(promoted.isCuratedExternalCatalog).toBe(true);
    expect(isCuratedExternalMember(promoted)).toBe(true);
  });

  it('curated external can retire without product deletion', () => {
    const retired = retireExternalFromCurated({
      supplyType: ProductSupplyType.external_source,
      isCuratedExternalCatalog: true,
    });
    expect(retired.isCuratedExternalCatalog).toBe(false);
    expect(retired.supplyType).toBe(ProductSupplyType.external_source);
    expect(isCuratedExternalMember(retired)).toBe(false);
  });

  it('scheduled import success does not mutate curated flag', () => {
    const patch = membershipPatchForScheduledImportSuccess();
    expect(patch).not.toHaveProperty('isCuratedExternalCatalog');
    expect(patch.supplyType).toBe(ProductSupplyType.external_source);
  });

  it('confirmed unavailable curated product is eligible for lower-priority recheck', () => {
    const decision = evaluateCatalogRefreshEligibility(
      {
        ...base,
        sourceAvailability: SourceCommercialAvailability.unavailable,
        sourceSyncStatus: SourceSyncStatus.fresh,
        availabilityLastConfirmedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      now,
      config,
    );
    expect(decision.eligible).toBe(true);
    expect(decision.priorityClass).toBe('OOS_RECHECK');
    expect(decision.priority).toBe(
      MarketplaceImportJobPriorityBand.OOS_RECHECK,
    );
  });

  it('removed product is excluded from normal refresh priority', () => {
    const decision = evaluateCatalogRefreshEligibility(
      {
        ...base,
        sourceAvailability: SourceCommercialAvailability.removed,
        sourceSyncStatus: SourceSyncStatus.fresh,
      },
      now,
      config,
    );
    expect(decision.eligible).toBe(false);
    expect(decision.detail).toContain('removed');
  });

  it('stale available curated product can become eligible', () => {
    const decision = evaluateCatalogRefreshEligibility(
      {
        ...base,
        sourceAvailability: SourceCommercialAvailability.available,
        sourceSyncStatus: SourceSyncStatus.fresh,
        availabilityLastConfirmedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      now,
      config,
    );
    expect(decision.eligible).toBe(true);
    expect(decision.reason).toBe('available_stale');
    expect(decision.priorityClass).toBe('CATALOG_LOW');
    expect(decision.tier).toBe('COLD');
  });

  it('fresh available curated product is not unnecessarily selected', () => {
    const decision = evaluateCatalogRefreshEligibility(
      {
        ...base,
        sourceAvailability: SourceCommercialAvailability.available,
        sourceSyncStatus: SourceSyncStatus.fresh,
        availabilityLastConfirmedAt: now,
      },
      now,
      config,
    );
    expect(decision.eligible).toBe(false);
    expect(decision.detail).toBe('available_fresh');
  });

  it('source circuit breaker pauses background work', () => {
    const breaker = new CatalogRefreshCircuitBreaker({
      ...config,
      circuitFailureThreshold: 3,
      circuitWindowMs: 60_000,
      circuitCooldownMs: 120_000,
    });
    expect(breaker.isOpen('trendyol', now)).toBe(false);
    breaker.recordFailure('trendyol', now);
    breaker.recordFailure('trendyol', now);
    breaker.recordFailure('trendyol', now);
    expect(breaker.isOpen('trendyol', now)).toBe(true);
    breaker.recordSuccess('trendyol');
    expect(breaker.isOpen('trendyol', now)).toBe(false);
  });

  it('SOURCE_ERROR does not mark products unavailable', () => {
    const available = {
      ...createInitialSourceAvailabilityProjection(),
      sourceAvailability: SourceCommercialAvailability.available,
      sourceSyncStatus: SourceSyncStatus.fresh,
      availabilityLastConfirmedAt: now,
    };
    const failed = applySourceSyncFailure(available, {
      errorCode: SourceSyncErrorCode.RATE_LIMIT,
      attemptedAt: now,
    });
    expect(failed.sourceAvailability).toBe(
      SourceCommercialAvailability.available,
    );
    expect(failed.sourceSyncStatus).toBe(SourceSyncStatus.source_error);
  });

  it('config values are centralized loader', () => {
    expect(config.hardMaxItemsPerRun).toBeLessThanOrEqual(500);
    expect(config.defaultBatchSize).toBeLessThanOrEqual(
      config.hardMaxItemsPerRun,
    );
    expect(config.liveEnqueueEnabled).toBe(false);
    expect(config.maxConcurrencyPerSource).toBeGreaterThanOrEqual(1);
  });

  it('capacity model conceptually counts curated external only', () => {
    const curatedExternal = [
      { supplyType: 'external_source', isCuratedExternalCatalog: true },
      { supplyType: 'external_source', isCuratedExternalCatalog: true },
    ];
    const onDemandExternal = [
      { supplyType: 'external_source', isCuratedExternalCatalog: false },
    ];
    const capacityCount = [...curatedExternal, ...onDemandExternal].filter(
      (p) =>
        p.supplyType === ProductSupplyType.external_source &&
        p.isCuratedExternalCatalog,
    ).length;
    expect(capacityCount).toBe(2);
  });

  it('hard max guard concept: effective max never exceeds hard max', () => {
    const requested = 9999;
    const effective = Math.min(requested, config.hardMaxItemsPerRun);
    expect(effective).toBe(config.hardMaxItemsPerRun);
  });
});
