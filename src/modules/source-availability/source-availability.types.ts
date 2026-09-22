/**
 * Source-agnostic commercial availability + sync/freshness foundation (Phase A1).
 *
 * Commercial availability and sync health are intentionally separate.
 * Adapters must normalize retailer payloads before calling these helpers —
 * this module must never branch on retailer-specific field names.
 *
 * Fields currently live on Product as a compatibility bridge toward:
 *   CanonicalProduct → SourceOffer[] → availability/freshness
 */

/** Confirmed commercial state from a successful authoritative source snapshot. */
export enum SourceCommercialAvailability {
  available = 'available',
  unavailable = 'unavailable',
  unknown = 'unknown',
  removed = 'removed',
}

/**
 * Sync / freshness health. Never use these as customer "ناموجود" signals.
 * Example: availability=available + syncStatus=source_error is valid.
 */
export enum SourceSyncStatus {
  fresh = 'fresh',
  stale = 'stale',
  source_error = 'source_error',
  never_verified = 'never_verified',
}

/** Bounded diagnostic codes — not customer-facing. */
export enum SourceSyncErrorCode {
  TIMEOUT = 'TIMEOUT',
  HTTP_ERROR = 'HTTP_ERROR',
  RATE_LIMIT = 'RATE_LIMIT',
  BLOCKED = 'BLOCKED',
  PARSE_ERROR = 'PARSE_ERROR',
  INCOMPLETE_RESPONSE = 'INCOMPLETE_RESPONSE',
  SOURCE_UNAVAILABLE = 'SOURCE_UNAVAILABLE',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Projection stored today on Product; later extractable onto SourceOffer
 * without changing helper contracts.
 */
export type SourceAvailabilityProjection = {
  sourceAvailability: SourceCommercialAvailability;
  sourceSyncStatus: SourceSyncStatus;
  /** Last successful snapshot that produced available/unavailable/removed. */
  availabilityLastConfirmedAt: Date | null;
  /** Last refresh attempt (success or failure). */
  sourceLastAttemptAt: Date | null;
  /** Last successful fetch/parse (may precede commercial confirmation). */
  sourceLastSuccessAt: Date | null;
  /** Last failed attempt. */
  sourceLastErrorAt: Date | null;
  sourceSyncErrorCode: string | null;
  sourceSyncErrorDetail: string | null;
};

/**
 * Adapter-normalized commercial outcome.
 * Retailer-specific flags (inStock, isSellable, …) must be mapped here by adapters.
 */
export type NormalizedSourceCommercialSnapshot = {
  outcome: 'available' | 'unavailable' | 'removed';
  observedAt?: Date;
};

export type NormalizedSourceFailure = {
  errorCode: SourceSyncErrorCode | string;
  detail?: string | null;
  attemptedAt?: Date;
};

export const SOURCE_SYNC_ERROR_DETAIL_MAX_LENGTH = 255;
