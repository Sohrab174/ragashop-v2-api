/**
 * Suggestion query validation for GET /catalog/search/suggestions.
 */

import {
  normalizeSearchQuery,
  SEARCH_MAX_QUERY_LENGTH,
} from './search-normalize';
import {
  SUGGESTION_MAX_QUERY_LENGTH,
  SUGGESTION_MAX_RESULTS,
} from './suggestion-ranking';

export type StorefrontSuggestionQuery = {
  q: string;
  normalizedQ: string;
  limit: number;
};

export type StorefrontSuggestionQueryError = {
  code: 'invalid_q' | 'q_too_long' | 'invalid_limit';
  message: string;
};

export function parseStorefrontSuggestionQuery(input: {
  q?: unknown;
  limit?: unknown;
}):
  | { ok: true; value: StorefrontSuggestionQuery }
  | { ok: false; error: StorefrontSuggestionQueryError } {
  if (input.q === undefined || input.q === null) {
    return {
      ok: false,
      error: { code: 'invalid_q', message: 'عبارت پیشنهاد الزامی است.' },
    };
  }
  const rawFull = String(input.q);
  if (!rawFull.trim()) {
    return {
      ok: false,
      error: { code: 'invalid_q', message: 'عبارت پیشنهاد الزامی است.' },
    };
  }
  const maxLen = Math.min(SUGGESTION_MAX_QUERY_LENGTH, SEARCH_MAX_QUERY_LENGTH);
  if (rawFull.trim().length > maxLen) {
    return {
      ok: false,
      error: {
        code: 'q_too_long',
        message: `حداکثر طول عبارت پیشنهاد ${maxLen} نویسه است.`,
      },
    };
  }

  const normalized = normalizeSearchQuery(rawFull.slice(0, maxLen));
  if (!normalized.normalized) {
    return {
      ok: false,
      error: { code: 'invalid_q', message: 'عبارت پیشنهاد نامعتبر است.' },
    };
  }

  const limitRaw =
    input.limit === undefined || input.limit === null || input.limit === ''
      ? SUGGESTION_MAX_RESULTS
      : Number(input.limit);
  if (
    !Number.isFinite(limitRaw) ||
    !Number.isInteger(limitRaw) ||
    limitRaw < 1 ||
    limitRaw > SUGGESTION_MAX_RESULTS
  ) {
    return {
      ok: false,
      error: {
        code: 'invalid_limit',
        message: `تعداد پیشنهادات باید بین ۱ و ${SUGGESTION_MAX_RESULTS} باشد.`,
      },
    };
  }

  return {
    ok: true,
    value: {
      q: normalized.raw,
      normalizedQ: normalized.normalized,
      limit: limitRaw,
    },
  };
}
