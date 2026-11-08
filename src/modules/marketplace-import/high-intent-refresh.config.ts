import { parsePositiveIntConfig } from './marketplace-config.util';
import { CUSTOMER_PURCHASE_FRESHNESS_MS } from '../source-availability/customer-freshness';

export interface HighIntentRefreshPolicy {
  /**
   * Paste-a-Link may trust an otherwise healthy existing product only when
   * availabilityLastConfirmedAt is newer than this TTL.
   * Five minutes maximum. The environment value may shorten, never lengthen,
   * the customer purchase verification window.
   */
  freshnessTtlMs: number;
}

/** Purchase-intent freshness default: 5 minutes. */
export const HIGH_INTENT_FRESHNESS_TTL_MS_DEFAULT = 5 * 60 * 1000;

export function loadHighIntentRefreshPolicy(): HighIntentRefreshPolicy {
  const configuredTtlMs = parsePositiveIntConfig(
    process.env.HIGH_INTENT_FRESHNESS_TTL_MS,
    HIGH_INTENT_FRESHNESS_TTL_MS_DEFAULT,
    60 * 1000,
    90 * 24 * 60 * 60 * 1000,
    'HIGH_INTENT_FRESHNESS_TTL_MS',
  );
  return {
    freshnessTtlMs: Math.min(configuredTtlMs, CUSTOMER_PURCHASE_FRESHNESS_MS),
  };
}

export function validateHighIntentRefreshRuntimeConfig(): void {
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    return;
  }
  loadHighIntentRefreshPolicy();
}
