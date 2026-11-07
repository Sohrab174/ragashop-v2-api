import {
  SourceCommercialAvailability,
  SourceSyncStatus,
} from './source-availability.types';

export const CUSTOMER_PURCHASE_FRESHNESS_MS = 5 * 60 * 1000;
export const SHOWCASE_DISCOUNT_FRESHNESS_MS = 2 * 60 * 60 * 1000;

export type CustomerFreshnessInput = {
  supplyType?: string | null;
  sourceAvailability?: string | null;
  sourceSyncStatus?: string | null;
  availabilityLastConfirmedAt?: Date | string | null;
};

export function isFreshExternalCommercialData(
  input: CustomerFreshnessInput,
  now = Date.now(),
  maxAgeMs = CUSTOMER_PURCHASE_FRESHNESS_MS,
): boolean {
  if (input.supplyType !== 'external_source') return true;
  if (
    input.sourceAvailability !== SourceCommercialAvailability.available ||
    input.sourceSyncStatus !== SourceSyncStatus.fresh ||
    input.availabilityLastConfirmedAt == null
  ) return false;
  const confirmedAt = new Date(input.availabilityLastConfirmedAt).getTime();
  return Number.isFinite(confirmedAt) && now >= confirmedAt && now - confirmedAt < maxAgeMs;
}

export function isFreshShowcaseDiscount(
  input: CustomerFreshnessInput,
  now = Date.now(),
): boolean {
  return isFreshExternalCommercialData(input, now, SHOWCASE_DISCOUNT_FRESHNESS_MS);
}
