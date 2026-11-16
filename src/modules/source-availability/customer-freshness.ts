import {
  SourceCommercialAvailability,
  SourceSyncStatus,
} from './source-availability.types';

export const CUSTOMER_PURCHASE_FRESHNESS_MS = 5 * 60 * 1000;
/** Default showcase discount badge window after successful PDP verification. */
export const SHOWCASE_DISCOUNT_FRESHNESS_MS = 24 * 60 * 60 * 1000;
/**
 * Public showcase listing freshness (PLP / category / home discovery).
 * Aligns with HOT refresh cadence (default 48h). Does NOT replace:
 * - 5-minute purchase verification
 * - discount badge freshness (default 24h, optional earlier campaign window)
 */
export const SHOWCASE_LISTING_FRESHNESS_MS = 2 * 24 * 60 * 60 * 1000;

export type CustomerFreshnessInput = {
  supplyType?: string | null;
  sourceAvailability?: string | null;
  sourceSyncStatus?: string | null;
  availabilityLastConfirmedAt?: Date | string | null;
  /**
   * Optional hard display deadline (e.g. earlier Flash campaign window end).
   * Never implies a guaranteed purchase price — purchase stays on 5-minute freshness.
   */
  discountDisplayExpiresAt?: Date | string | null;
};

export function resolveShowcaseListingFreshnessMs(
  raw = process.env.SHOWCASE_LISTING_FRESHNESS_MS,
): number {
  if (raw == null || String(raw).trim() === '') {
    return SHOWCASE_LISTING_FRESHNESS_MS;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 60_000) return SHOWCASE_LISTING_FRESHNESS_MS;
  return Math.floor(n);
}

export function resolveShowcaseDiscountFreshnessMs(
  raw = process.env.SHOWCASE_DISCOUNT_FRESHNESS_MS,
): number {
  if (raw == null || String(raw).trim() === '') {
    return SHOWCASE_DISCOUNT_FRESHNESS_MS;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 60_000) return SHOWCASE_DISCOUNT_FRESHNESS_MS;
  return Math.floor(n);
}

/**
 * Absolute display deadline = min(confirmedAt + discountTTL, campaignWindowEndsAt?).
 * Campaign tag windows are listing-set signals, not product-specific guarantees.
 */
export function resolveDiscountDisplayExpiresAt(
  confirmedAt: Date | string | null | undefined,
  campaignWindowEndsAt?: Date | string | null,
  discountTtlMs = resolveShowcaseDiscountFreshnessMs(),
): Date | null {
  if (confirmedAt == null) return null;
  const confirmedMs = new Date(confirmedAt).getTime();
  if (!Number.isFinite(confirmedMs)) return null;
  let expiresMs = confirmedMs + discountTtlMs;
  if (campaignWindowEndsAt != null) {
    const campaignMs = new Date(campaignWindowEndsAt).getTime();
    if (Number.isFinite(campaignMs)) {
      expiresMs = Math.min(expiresMs, campaignMs);
    }
  }
  return new Date(expiresMs);
}

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
  )
    return false;
  const confirmedAt = new Date(input.availabilityLastConfirmedAt).getTime();
  return (
    Number.isFinite(confirmedAt) &&
    now >= confirmedAt &&
    now - confirmedAt < maxAgeMs
  );
}

export function isFreshShowcaseDiscount(
  input: CustomerFreshnessInput,
  now = Date.now(),
): boolean {
  const maxAgeMs = resolveShowcaseDiscountFreshnessMs();
  if (!isFreshExternalCommercialData(input, now, maxAgeMs)) return false;
  if (input.discountDisplayExpiresAt != null) {
    const ends = new Date(input.discountDisplayExpiresAt).getTime();
    if (!Number.isFinite(ends) || now >= ends) return false;
  }
  return true;
}

/** External curated listing may appear in public showcase discovery. */
export function isFreshShowcaseListing(
  input: CustomerFreshnessInput,
  now = Date.now(),
  maxAgeMs = resolveShowcaseListingFreshnessMs(),
): boolean {
  return isFreshExternalCommercialData(input, now, maxAgeMs);
}
