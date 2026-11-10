import { ProductSupplyType } from '../catalog-lifecycle/catalog-lifecycle.types';
import {
  isCommercialConfirmationStaleByPolicy,
  SourceCommercialAvailability,
  SourceSyncStatus,
} from '../source-availability';
import { HighIntentRefreshPolicy } from './high-intent-refresh.config';

/**
 * Typed decision reasons for Paste-a-Link high-intent refresh.
 * Also used as structured log `reason` values.
 */
export type HighIntentRefreshReason =
  | 'existing_fast_path'
  | 'refresh_required_stale'
  | 'refresh_required_unknown'
  | 'refresh_required_source_error'
  | 'refresh_required_never_verified'
  | 'refresh_required_unavailable'
  | 'refresh_required_invalid_state'
  | 'refresh_required_ttl'
  | 'removed_no_refresh'
  | 'native_no_refresh'
  | 'new_product_import';

export type HighIntentRefreshDecision = {
  refresh: boolean;
  reason: HighIntentRefreshReason;
};

export type HighIntentRefreshProductInput = {
  supplyType: ProductSupplyType | string | null | undefined;
  sourceAvailability: SourceCommercialAvailability | string | null | undefined;
  sourceSyncStatus: SourceSyncStatus | string | null | undefined;
  availabilityLastConfirmedAt: Date | string | null | undefined;
};

function toDateOrNull(
  value: Date | string | null | undefined,
): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * Authoritative Paste-a-Link decision: should this existing external product
 * be refreshed because the customer explicitly pasted its source URL?
 *
 * Not the A5 catalog scheduler. Native marketplace inventory is never
 * crawler-refreshed. Authoritative REMOVED is not re-crawled (no hammering).
 */
export function shouldHighIntentRefresh(
  product: HighIntentRefreshProductInput,
  now: Date,
  policy: HighIntentRefreshPolicy,
): HighIntentRefreshDecision {
  if (product.supplyType === ProductSupplyType.native_marketplace) {
    return { refresh: false, reason: 'native_no_refresh' };
  }

  if (product.sourceAvailability === SourceCommercialAvailability.removed) {
    return { refresh: false, reason: 'removed_no_refresh' };
  }

  if (product.sourceSyncStatus === SourceSyncStatus.never_verified) {
    return { refresh: true, reason: 'refresh_required_never_verified' };
  }

  if (product.sourceAvailability === SourceCommercialAvailability.unknown) {
    return { refresh: true, reason: 'refresh_required_unknown' };
  }

  if (product.sourceSyncStatus === SourceSyncStatus.source_error) {
    return { refresh: true, reason: 'refresh_required_source_error' };
  }

  if (product.sourceAvailability === SourceCommercialAvailability.unavailable) {
    return { refresh: true, reason: 'refresh_required_unavailable' };
  }

  if (product.sourceSyncStatus === SourceSyncStatus.stale) {
    return { refresh: true, reason: 'refresh_required_stale' };
  }

  // The fast path is valid only for a fully recognized, verified state.
  // Missing or malformed persisted values must fail closed just like the
  // customer purchase freshness check.
  if (
    product.sourceAvailability !== SourceCommercialAvailability.available ||
    product.sourceSyncStatus !== SourceSyncStatus.fresh
  ) {
    return { refresh: true, reason: 'refresh_required_invalid_state' };
  }

  const confirmedAt = toDateOrNull(product.availabilityLastConfirmedAt);
  if (confirmedAt && confirmedAt.getTime() > now.getTime()) {
    return { refresh: true, reason: 'refresh_required_invalid_state' };
  }
  const staleByTtl = isCommercialConfirmationStaleByPolicy(
    {
      sourceAvailability:
        (product.sourceAvailability as SourceCommercialAvailability) ||
        SourceCommercialAvailability.unknown,
      sourceSyncStatus:
        (product.sourceSyncStatus as SourceSyncStatus) ||
        SourceSyncStatus.never_verified,
      availabilityLastConfirmedAt: confirmedAt,
      sourceLastAttemptAt: null,
      sourceLastSuccessAt: null,
      sourceLastErrorAt: null,
      sourceSyncErrorCode: null,
      sourceSyncErrorDetail: null,
    },
    (at) => now.getTime() - at.getTime() >= policy.freshnessTtlMs,
  );

  if (staleByTtl) {
    return { refresh: true, reason: 'refresh_required_ttl' };
  }

  return { refresh: false, reason: 'existing_fast_path' };
}
