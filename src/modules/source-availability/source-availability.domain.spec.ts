import {
  applyConfirmedCommercialSnapshot,
  applySourceSyncFailure,
  createInitialSourceAvailabilityProjection,
  isCommercialConfirmationStaleByPolicy,
  isEligibleForUnavailableRecheck,
  markSourceAvailabilityStale,
  sanitizeSourceSyncErrorDetail,
} from './source-availability.domain';
import {
  SOURCE_SYNC_ERROR_DETAIL_MAX_LENGTH,
  SourceCommercialAvailability,
  SourceSyncErrorCode,
  SourceSyncStatus,
} from './source-availability.types';

describe('source-availability domain (A1)', () => {
  const t0 = new Date('2026-09-01T12:00:00.000Z');
  const t1 = new Date('2026-09-02T12:00:00.000Z');
  const t2 = new Date('2026-09-03T12:00:00.000Z');

  it('creates UNKNOWN + NEVER_VERIFIED initial projection (safe backfill shape)', () => {
    const initial = createInitialSourceAvailabilityProjection();
    expect(initial).toEqual({
      sourceAvailability: SourceCommercialAvailability.unknown,
      sourceSyncStatus: SourceSyncStatus.never_verified,
      availabilityLastConfirmedAt: null,
      sourceLastAttemptAt: null,
      sourceLastSuccessAt: null,
      sourceLastErrorAt: null,
      sourceSyncErrorCode: null,
      sourceSyncErrorDetail: null,
    });
  });

  it('AVAILABLE + FRESH is valid after confirmed available snapshot', () => {
    const next = applyConfirmedCommercialSnapshot(
      createInitialSourceAvailabilityProjection(),
      { outcome: 'available', observedAt: t0 },
    );
    expect(next.sourceAvailability).toBe(
      SourceCommercialAvailability.available,
    );
    expect(next.sourceSyncStatus).toBe(SourceSyncStatus.fresh);
    expect(next.availabilityLastConfirmedAt).toEqual(t0);
    expect(next.sourceLastAttemptAt).toEqual(t0);
    expect(next.sourceLastSuccessAt).toEqual(t0);
    expect(next.sourceSyncErrorCode).toBeNull();
  });

  it('AVAILABLE + SOURCE_ERROR is valid and preserves prior availability', () => {
    const available = applyConfirmedCommercialSnapshot(
      createInitialSourceAvailabilityProjection(),
      { outcome: 'available', observedAt: t0 },
    );
    const failed = applySourceSyncFailure(available, {
      errorCode: SourceSyncErrorCode.TIMEOUT,
      detail: 'gateway timeout',
      attemptedAt: t1,
    });
    expect(failed.sourceAvailability).toBe(
      SourceCommercialAvailability.available,
    );
    expect(failed.sourceSyncStatus).toBe(SourceSyncStatus.source_error);
    expect(failed.availabilityLastConfirmedAt).toEqual(t0);
    expect(failed.sourceLastAttemptAt).toEqual(t1);
    expect(failed.sourceLastSuccessAt).toEqual(t0);
    expect(failed.sourceLastErrorAt).toEqual(t1);
    expect(failed.sourceSyncErrorCode).toBe(SourceSyncErrorCode.TIMEOUT);
  });

  it('UNAVAILABLE + FRESH is valid after confirmed unavailable snapshot', () => {
    const next = applyConfirmedCommercialSnapshot(
      createInitialSourceAvailabilityProjection(),
      { outcome: 'unavailable', observedAt: t0 },
    );
    expect(next.sourceAvailability).toBe(
      SourceCommercialAvailability.unavailable,
    );
    expect(next.sourceSyncStatus).toBe(SourceSyncStatus.fresh);
    expect(isEligibleForUnavailableRecheck(next)).toBe(true);
  });

  it('UNKNOWN + NEVER_VERIFIED is valid', () => {
    const initial = createInitialSourceAvailabilityProjection();
    expect(initial.sourceAvailability).toBe(
      SourceCommercialAvailability.unknown,
    );
    expect(initial.sourceSyncStatus).toBe(SourceSyncStatus.never_verified);
  });

  it('source failure does not convert previous AVAILABLE to UNAVAILABLE', () => {
    const available = applyConfirmedCommercialSnapshot(
      createInitialSourceAvailabilityProjection(),
      { outcome: 'available', observedAt: t0 },
    );
    const failed = applySourceSyncFailure(available, {
      errorCode: SourceSyncErrorCode.PARSE_ERROR,
      attemptedAt: t1,
    });
    expect(failed.sourceAvailability).toBe(
      SourceCommercialAvailability.available,
    );
    expect(failed.sourceAvailability).not.toBe(
      SourceCommercialAvailability.unavailable,
    );
  });

  it('source failure does not convert previous UNAVAILABLE to AVAILABLE', () => {
    const unavailable = applyConfirmedCommercialSnapshot(
      createInitialSourceAvailabilityProjection(),
      { outcome: 'unavailable', observedAt: t0 },
    );
    const failed = applySourceSyncFailure(unavailable, {
      errorCode: SourceSyncErrorCode.HTTP_ERROR,
      detail: '502',
      attemptedAt: t1,
    });
    expect(failed.sourceAvailability).toBe(
      SourceCommercialAvailability.unavailable,
    );
    expect(failed.sourceSyncStatus).toBe(SourceSyncStatus.source_error);
  });

  it('successful authoritative snapshot can update UNKNOWN -> AVAILABLE', () => {
    const next = applyConfirmedCommercialSnapshot(
      createInitialSourceAvailabilityProjection(),
      { outcome: 'available', observedAt: t0 },
    );
    expect(next.sourceAvailability).toBe(
      SourceCommercialAvailability.available,
    );
  });

  it('successful authoritative snapshot can update AVAILABLE -> UNAVAILABLE', () => {
    const available = applyConfirmedCommercialSnapshot(
      createInitialSourceAvailabilityProjection(),
      { outcome: 'available', observedAt: t0 },
    );
    const unavailable = applyConfirmedCommercialSnapshot(available, {
      outcome: 'unavailable',
      observedAt: t1,
    });
    expect(unavailable.sourceAvailability).toBe(
      SourceCommercialAvailability.unavailable,
    );
    expect(unavailable.availabilityLastConfirmedAt).toEqual(t1);
  });

  it('successful authoritative removed response can produce REMOVED', () => {
    const available = applyConfirmedCommercialSnapshot(
      createInitialSourceAvailabilityProjection(),
      { outcome: 'available', observedAt: t0 },
    );
    const removed = applyConfirmedCommercialSnapshot(available, {
      outcome: 'removed',
      observedAt: t1,
    });
    expect(removed.sourceAvailability).toBe(
      SourceCommercialAvailability.removed,
    );
    expect(removed.sourceSyncStatus).toBe(SourceSyncStatus.fresh);
  });

  it('timestamps follow documented semantics across success then failure', () => {
    const available = applyConfirmedCommercialSnapshot(
      createInitialSourceAvailabilityProjection(),
      { outcome: 'available', observedAt: t0 },
    );
    const failed = applySourceSyncFailure(available, {
      errorCode: SourceSyncErrorCode.RATE_LIMIT,
      attemptedAt: t1,
    });
    const recovered = applyConfirmedCommercialSnapshot(failed, {
      outcome: 'available',
      observedAt: t2,
    });

    expect(failed.availabilityLastConfirmedAt).toEqual(t0);
    expect(failed.sourceLastErrorAt).toEqual(t1);
    expect(recovered.availabilityLastConfirmedAt).toEqual(t2);
    expect(recovered.sourceLastAttemptAt).toEqual(t2);
    expect(recovered.sourceLastSuccessAt).toEqual(t2);
    expect(recovered.sourceSyncErrorCode).toBeNull();
    expect(recovered.sourceLastErrorAt).toEqual(t1);
  });

  it('existing-row backfill shape does not invent confirmation (no customer suppress signal)', () => {
    const backfill = createInitialSourceAvailabilityProjection();
    expect(backfill.sourceAvailability).toBe(
      SourceCommercialAvailability.unknown,
    );
    expect(backfill.availabilityLastConfirmedAt).toBeNull();
    // A4 suppress would require confirmed unavailable — not present here.
    expect(backfill.sourceAvailability).not.toBe(
      SourceCommercialAvailability.unavailable,
    );
  });

  it('generic domain logic does not require Trendyol-specific fields', () => {
    // Snapshot uses only normalized outcome — no inStock/isSellable/hasStock.
    const snapshot = { outcome: 'available' as const, observedAt: t0 };
    const next = applyConfirmedCommercialSnapshot(
      createInitialSourceAvailabilityProjection(),
      snapshot,
    );
    expect(Object.keys(snapshot)).toEqual(['outcome', 'observedAt']);
    expect(next.sourceAvailability).toBe(
      SourceCommercialAvailability.available,
    );
  });

  it('marks fresh confirmation stale without changing commercial state', () => {
    const available = applyConfirmedCommercialSnapshot(
      createInitialSourceAvailabilityProjection(),
      { outcome: 'available', observedAt: t0 },
    );
    const stale = markSourceAvailabilityStale(available);
    expect(stale.sourceAvailability).toBe(
      SourceCommercialAvailability.available,
    );
    expect(stale.sourceSyncStatus).toBe(SourceSyncStatus.stale);
  });

  it('does not overwrite never_verified or source_error when marking stale', () => {
    const never = markSourceAvailabilityStale(
      createInitialSourceAvailabilityProjection(),
    );
    expect(never.sourceSyncStatus).toBe(SourceSyncStatus.never_verified);

    const errored = applySourceSyncFailure(
      applyConfirmedCommercialSnapshot(
        createInitialSourceAvailabilityProjection(),
        { outcome: 'available', observedAt: t0 },
      ),
      { errorCode: SourceSyncErrorCode.BLOCKED, attemptedAt: t1 },
    );
    expect(markSourceAvailabilityStale(errored).sourceSyncStatus).toBe(
      SourceSyncStatus.source_error,
    );
  });

  it('policy stale helper uses caller TTL without hardcoding intervals', () => {
    const available = applyConfirmedCommercialSnapshot(
      createInitialSourceAvailabilityProjection(),
      { outcome: 'available', observedAt: t0 },
    );
    expect(isCommercialConfirmationStaleByPolicy(available, () => false)).toBe(
      false,
    );
    expect(isCommercialConfirmationStaleByPolicy(available, () => true)).toBe(
      true,
    );
    expect(
      isCommercialConfirmationStaleByPolicy(
        createInitialSourceAvailabilityProjection(),
        () => false,
      ),
    ).toBe(true);
  });

  it('sanitizes error detail length', () => {
    const long = 'x'.repeat(SOURCE_SYNC_ERROR_DETAIL_MAX_LENGTH + 50);
    expect(sanitizeSourceSyncErrorDetail(long)?.length).toBe(
      SOURCE_SYNC_ERROR_DETAIL_MAX_LENGTH,
    );
    expect(sanitizeSourceSyncErrorDetail('  ')).toBeNull();
  });
});
