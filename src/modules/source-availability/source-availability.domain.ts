import {
  NormalizedSourceCommercialSnapshot,
  NormalizedSourceFailure,
  SOURCE_SYNC_ERROR_DETAIL_MAX_LENGTH,
  SourceAvailabilityProjection,
  SourceCommercialAvailability,
  SourceSyncStatus,
} from './source-availability.types';

function nowOr(at?: Date): Date {
  return at ?? new Date();
}

export function sanitizeSourceSyncErrorDetail(
  detail?: string | null,
): string | null {
  if (detail == null) return null;
  const trimmed = String(detail).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, SOURCE_SYNC_ERROR_DETAIL_MAX_LENGTH);
}

/** Safe defaults for new rows / A1 backfill — not a commercial confirmation. */
export function createInitialSourceAvailabilityProjection(): SourceAvailabilityProjection {
  return {
    sourceAvailability: SourceCommercialAvailability.unknown,
    sourceSyncStatus: SourceSyncStatus.never_verified,
    availabilityLastConfirmedAt: null,
    sourceLastAttemptAt: null,
    sourceLastSuccessAt: null,
    sourceLastErrorAt: null,
    sourceSyncErrorCode: null,
    sourceSyncErrorDetail: null,
  };
}

function availabilityFromOutcome(
  outcome: NormalizedSourceCommercialSnapshot['outcome'],
): SourceCommercialAvailability {
  if (outcome === 'available') return SourceCommercialAvailability.available;
  if (outcome === 'unavailable')
    return SourceCommercialAvailability.unavailable;
  return SourceCommercialAvailability.removed;
}

/**
 * Apply an authoritative successful commercial snapshot.
 * Updates commercial availability + marks sync fresh; clears error diagnostics.
 */
export function applyConfirmedCommercialSnapshot(
  previous: SourceAvailabilityProjection,
  snapshot: NormalizedSourceCommercialSnapshot,
): SourceAvailabilityProjection {
  const at = nowOr(snapshot.observedAt);
  return {
    ...previous,
    sourceAvailability: availabilityFromOutcome(snapshot.outcome),
    sourceSyncStatus: SourceSyncStatus.fresh,
    availabilityLastConfirmedAt: at,
    sourceLastAttemptAt: at,
    sourceLastSuccessAt: at,
    sourceLastErrorAt: previous.sourceLastErrorAt,
    sourceSyncErrorCode: null,
    sourceSyncErrorDetail: null,
  };
}

/**
 * Record a source sync failure without mutating commercial availability.
 * Preserves prior AVAILABLE / UNAVAILABLE / UNKNOWN / REMOVED.
 */
export function applySourceSyncFailure(
  previous: SourceAvailabilityProjection,
  failure: NormalizedSourceFailure,
): SourceAvailabilityProjection {
  const at = nowOr(failure.attemptedAt);
  return {
    ...previous,
    sourceAvailability: previous.sourceAvailability,
    sourceSyncStatus: SourceSyncStatus.source_error,
    availabilityLastConfirmedAt: previous.availabilityLastConfirmedAt,
    sourceLastAttemptAt: at,
    sourceLastSuccessAt: previous.sourceLastSuccessAt,
    sourceLastErrorAt: at,
    sourceSyncErrorCode: String(failure.errorCode || 'UNKNOWN_ERROR'),
    sourceSyncErrorDetail: sanitizeSourceSyncErrorDetail(failure.detail),
  };
}

/**
 * Mark a previously verified projection as stale (TTL / policy layer).
 * Does not invent confirmation; never-verified and source_error stay unchanged.
 */
export function markSourceAvailabilityStale(
  previous: SourceAvailabilityProjection,
): SourceAvailabilityProjection {
  if (
    previous.sourceSyncStatus === SourceSyncStatus.never_verified ||
    previous.sourceSyncStatus === SourceSyncStatus.source_error
  ) {
    return previous;
  }
  return {
    ...previous,
    sourceSyncStatus: SourceSyncStatus.stale,
  };
}

/**
 * Read helper for future adaptive refresh — pure, no TTL hardcoded.
 * Caller supplies whether the confirmation age exceeds policy TTL.
 */
export function isCommercialConfirmationStaleByPolicy(
  projection: SourceAvailabilityProjection,
  isPastTtl: (confirmedAt: Date) => boolean,
): boolean {
  if (!projection.availabilityLastConfirmedAt) return true;
  if (projection.sourceAvailability === SourceCommercialAvailability.unknown) {
    return true;
  }
  return isPastTtl(projection.availabilityLastConfirmedAt);
}

/** Confirmed unavailable remains eligible for lower-frequency OOS recheck. */
export function isEligibleForUnavailableRecheck(
  projection: SourceAvailabilityProjection,
): boolean {
  return (
    projection.sourceAvailability === SourceCommercialAvailability.unavailable
  );
}

export function toSourceAvailabilityPatch(
  projection: SourceAvailabilityProjection,
): SourceAvailabilityProjection {
  return { ...projection };
}
