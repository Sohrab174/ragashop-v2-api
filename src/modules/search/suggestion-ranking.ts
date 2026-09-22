/**
 * Autocomplete / suggestion ranking — Search UX V1.1.
 * Centralized weights; do not hardcode brand names in ranking logic.
 */

export const SUGGESTION_RANKING_WEIGHTS = {
  exactBrandAlias: 1000,
  brandAliasPrefix: 900,
  brandNamePrefix: 850,
  categoryExact: 780,
  categoryPrefix: 700,
  categoryContains: 520,
  productTitlePrefix: 400,
} as const;

export const SUGGESTION_MAX_RESULTS = 8;
/** Product-title suggestions omitted for single-character queries (safety/cost). */
export const SUGGESTION_MIN_PRODUCT_QUERY_LENGTH = 2;
export const SUGGESTION_MAX_QUERY_LENGTH = 64;
