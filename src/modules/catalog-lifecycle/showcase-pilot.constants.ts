/**
 * Local Phase-1 verified showcase pilot — exact allowlist from dry-run.
 * Targeted refresh only; not a global catalog seed.
 */
export const SHOWCASE_PILOT_MAX_IDS = 40;

export const SHOWCASE_PILOT_ALLOWED_SOURCE = 'trendyol';

/** Separate from CATALOG_REFRESH_LIVE_ENABLED — pilot live enqueue only. */
export const SHOWCASE_PILOT_LIVE_ENABLED_ENV = 'SHOWCASE_PILOT_LIVE_ENABLED';

export const SHOWCASE_PILOT_DEFAULT_PRODUCT_IDS: readonly number[] = [
  97532, 97509, 97504, 97498, 97496, 97495, 97494, 97493, 97491, 97490, 97489,
  97488, 97569, 97567, 97566, 97559, 97558, 97459, 97458, 97457, 97463, 97462,
  97461, 97460, 97224, 97223, 97580, 97579, 97578, 97577, 97576, 96736, 156313,
  156312, 156311, 156310, 156309, 156308, 156307, 156306,
] as const;
