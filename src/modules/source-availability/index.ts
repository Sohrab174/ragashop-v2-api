export {
  SourceCommercialAvailability,
  SourceSyncStatus,
  SourceSyncErrorCode,
  SOURCE_SYNC_ERROR_DETAIL_MAX_LENGTH,
} from './source-availability.types';
export type {
  SourceAvailabilityProjection,
  NormalizedSourceCommercialSnapshot,
  NormalizedSourceFailure,
} from './source-availability.types';
export {
  sanitizeSourceSyncErrorDetail,
  createInitialSourceAvailabilityProjection,
  applyConfirmedCommercialSnapshot,
  applySourceSyncFailure,
  markSourceAvailabilityStale,
  isCommercialConfirmationStaleByPolicy,
  isEligibleForUnavailableRecheck,
  toSourceAvailabilityPatch,
} from './source-availability.domain';
