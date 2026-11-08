import { ProductSupplyType } from '../catalog-lifecycle/catalog-lifecycle.types';
import {
  SourceCommercialAvailability,
  SourceSyncStatus,
} from '../source-availability';
import { HIGH_INTENT_FRESHNESS_TTL_MS_DEFAULT } from './high-intent-refresh.config';
import {
  HighIntentRefreshProductInput,
  shouldHighIntentRefresh,
} from './high-intent-refresh.policy';

describe('shouldHighIntentRefresh', () => {
  const now = new Date('2026-09-21T12:00:00.000Z');
  const policy = { freshnessTtlMs: HIGH_INTENT_FRESHNESS_TTL_MS_DEFAULT };
  const recent = new Date('2026-09-21T11:59:00.000Z');
  const old = new Date('2026-09-01T12:00:00.000Z');

  const healthy: HighIntentRefreshProductInput = {
    supplyType: ProductSupplyType.external_source,
    sourceAvailability: SourceCommercialAvailability.available,
    sourceSyncStatus: SourceSyncStatus.fresh,
    availabilityLastConfirmedAt: recent,
  };

  it('returns existing_fast_path for healthy fresh external product within TTL', () => {
    expect(shouldHighIntentRefresh(healthy, now, policy)).toEqual({
      refresh: false,
      reason: 'existing_fast_path',
    });
  });

  it('requires refresh for STALE sync status', () => {
    expect(
      shouldHighIntentRefresh(
        { ...healthy, sourceSyncStatus: SourceSyncStatus.stale },
        now,
        policy,
      ),
    ).toEqual({ refresh: true, reason: 'refresh_required_stale' });
  });

  it('requires refresh for NEVER_VERIFIED', () => {
    expect(
      shouldHighIntentRefresh(
        {
          ...healthy,
          sourceSyncStatus: SourceSyncStatus.never_verified,
          availabilityLastConfirmedAt: null,
        },
        now,
        policy,
      ),
    ).toEqual({ refresh: true, reason: 'refresh_required_never_verified' });
  });

  it('requires refresh for SOURCE_ERROR without catalog cooldown', () => {
    expect(
      shouldHighIntentRefresh(
        { ...healthy, sourceSyncStatus: SourceSyncStatus.source_error },
        now,
        policy,
      ),
    ).toEqual({ refresh: true, reason: 'refresh_required_source_error' });
  });

  it('requires refresh for UNKNOWN availability even if otherwise fresh', () => {
    expect(
      shouldHighIntentRefresh(
        { ...healthy, sourceAvailability: SourceCommercialAvailability.unknown },
        now,
        policy,
      ),
    ).toEqual({ refresh: true, reason: 'refresh_required_unknown' });
  });

  it('requires refresh for UNAVAILABLE (high-intent recheck)', () => {
    expect(
      shouldHighIntentRefresh(
        {
          ...healthy,
          sourceAvailability: SourceCommercialAvailability.unavailable,
        },
        now,
        policy,
      ),
    ).toEqual({ refresh: true, reason: 'refresh_required_unavailable' });
  });

  it('does not refresh authoritatively REMOVED products (no hammering)', () => {
    expect(
      shouldHighIntentRefresh(
        {
          ...healthy,
          sourceAvailability: SourceCommercialAvailability.removed,
          sourceSyncStatus: SourceSyncStatus.stale,
        },
        now,
        policy,
      ),
    ).toEqual({ refresh: false, reason: 'removed_no_refresh' });
  });

  it('requires refresh when confirmation is older than TTL', () => {
    expect(
      shouldHighIntentRefresh(
        { ...healthy, availabilityLastConfirmedAt: old },
        now,
        policy,
      ),
    ).toEqual({ refresh: true, reason: 'refresh_required_ttl' });
  });

  it('keeps fast path when confirmation is within TTL', () => {
    expect(
      shouldHighIntentRefresh(
        { ...healthy, availabilityLastConfirmedAt: recent },
        now,
        policy,
      ),
    ).toEqual({ refresh: false, reason: 'existing_fast_path' });
  });

  it('does not make native marketplace inventory crawler-dependent', () => {
    expect(
      shouldHighIntentRefresh(
        {
          ...healthy,
          supplyType: ProductSupplyType.native_marketplace,
          sourceSyncStatus: SourceSyncStatus.stale,
        },
        now,
        policy,
      ),
    ).toEqual({ refresh: false, reason: 'native_no_refresh' });
  });

  it('still refreshes curated and non-curated external products the same way', () => {
    expect(
      shouldHighIntentRefresh(
        { ...healthy, sourceSyncStatus: SourceSyncStatus.stale },
        now,
        policy,
      ).refresh,
    ).toBe(true);
  });

  it('REMOVED wins over UNKNOWN/STALE so permanent removal is not recrawled', () => {
    const decision = shouldHighIntentRefresh(
      {
        supplyType: ProductSupplyType.external_source,
        sourceAvailability: SourceCommercialAvailability.removed,
        sourceSyncStatus: SourceSyncStatus.never_verified,
        availabilityLastConfirmedAt: null,
      },
      now,
      policy,
    );
    expect(decision).toEqual({ refresh: false, reason: 'removed_no_refresh' });
  });

  it('uses policy TTL rather than a hardcoded threshold', () => {
    const shortTtl = { freshnessTtlMs: 60 * 1000 };
    const twoMinutesAgo = new Date('2026-09-21T11:58:00.000Z');
    expect(
      shouldHighIntentRefresh(
        { ...healthy, availabilityLastConfirmedAt: twoMinutesAgo },
        now,
        shortTtl,
      ),
    ).toEqual({ refresh: true, reason: 'refresh_required_ttl' });
    expect(
      shouldHighIntentRefresh(
        { ...healthy, availabilityLastConfirmedAt: twoMinutesAgo },
        now,
        policy,
      ),
    ).toEqual({ refresh: false, reason: 'existing_fast_path' });
  });
});
