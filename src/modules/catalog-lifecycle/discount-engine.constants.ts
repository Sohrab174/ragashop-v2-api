/** Opt-in live PDP verification for the daily discount engine. */
export const DISCOUNT_ENGINE_LIVE_ENABLED_ENV = 'DISCOUNT_ENGINE_LIVE_ENABLED';

/** Allow live Trendyol listing probes during dry-run (still no PDP). */
export const DISCOUNT_ENGINE_LIVE_LISTING_ENV = 'DISCOUNT_ENGINE_LIVE_LISTING';

export const DISCOUNT_ENGINE_LISTING_BUDGET_ENV =
  'DISCOUNT_ENGINE_LISTING_BUDGET';
export const DISCOUNT_ENGINE_PDP_BUDGET_ENV = 'DISCOUNT_ENGINE_PDP_BUDGET';
export const DISCOUNT_ENGINE_POOL_TARGET_MIN_ENV =
  'DISCOUNT_ENGINE_POOL_TARGET_MIN';
export const DISCOUNT_ENGINE_POOL_TARGET_MAX_ENV =
  'DISCOUNT_ENGINE_POOL_TARGET_MAX';

export const DISCOUNT_ENGINE_DEFAULT_LISTING_BUDGET = 20;
export const DISCOUNT_ENGINE_DEFAULT_PDP_BUDGET = 60;
export const DISCOUNT_ENGINE_DEFAULT_POOL_MIN = 30;
export const DISCOUNT_ENGINE_DEFAULT_POOL_MAX = 50;

/**
 * Trendyol leaf sourceName values confirmed IN_SCOPE in Local category table
 * (Phase 1/2). Ambiguous beauty/cleaning leaves are intentionally omitted.
 */
export const DISCOUNT_ENGINE_ALLOWED_TRENDYOL_CATEGORY_NAMES: readonly string[] =
  [
    'Bluz',
    'Elbise',
    'Kazak',
    'T-Shirt',
    'Tshirt',
    'Gömlek',
    'Pantolon',
    'Jean',
    'Etek',
    'Hırka',
    'Sweatshirt',
    'Mont',
    'Kaban',
    'Ayakkabı',
    'Sneaker',
    'Çanta',
    'Şemsiye',
    'Bilezik',
  ] as const;

/** Seed category wc ids for sst discount sort discovery. */
export const DISCOUNT_ENGINE_DEFAULT_WC_IDS: readonly string[] = [
  '120', // jean
  '1019', // bluz
  '56', // elbise
  '1092', // kazak
  '1018', // tshirt-ish
  '1172', // sneaker
] as const;
