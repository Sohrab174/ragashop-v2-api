import { parsePositiveIntConfig } from './marketplace-config.util';

export interface HighIntentRefreshPolicy {
  /**
   * Paste-a-Link may trust an otherwise healthy existing product only when
   * availabilityLastConfirmedAt is newer than this TTL.
   * Default: 24 hours. Env: HIGH_INTENT_FRESHNESS_TTL_MS.
   */
  freshnessTtlMs: number;
}

/** Conservative user-intent default: 24 hours. */
export const HIGH_INTENT_FRESHNESS_TTL_MS_DEFAULT = 24 * 60 * 60 * 1000;

export function loadHighIntentRefreshPolicy(): HighIntentRefreshPolicy {
  return {
    freshnessTtlMs: parsePositiveIntConfig(
      process.env.HIGH_INTENT_FRESHNESS_TTL_MS,
      HIGH_INTENT_FRESHNESS_TTL_MS_DEFAULT,
      60 * 1000,
      90 * 24 * 60 * 60 * 1000,
      'HIGH_INTENT_FRESHNESS_TTL_MS',
    ),
  };
}

export function validateHighIntentRefreshRuntimeConfig(): void {
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    return;
  }
  loadHighIntentRefreshPolicy();
}
