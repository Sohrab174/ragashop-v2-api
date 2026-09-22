/**
 * Search V1 — reusable query normalization.
 * Shared by request parsing, brand-alias matching, and future indexing.
 * No external translation services.
 */

export const SEARCH_MAX_QUERY_LENGTH = 120;
export const SEARCH_MAX_TOKENS = 8;

export type NormalizedSearchQuery = {
  /** Original trimmed input (bounded). */
  raw: string;
  /** Fully normalized string (whitespace collapsed, script fixes, Latin lower). */
  normalized: string;
  /** Safe tokens for matching (digits preserved; empty tokens dropped). */
  tokens: string[];
};

/** Arabic Yeh / Kaf → Persian forms used in RagaShop catalog copy. */
export function normalizePersianArabicLetters(value: string): string {
  return value
    .replace(/\u064A/g, '\u06CC') // ي → ی
    .replace(/\u0643/g, '\u06A9') // ك → ک
    .replace(/\u0629/g, '\u0647') // ة → ه (harmless storefront variant)
    .replace(/\u0640/g, ''); // tatweel
}

/** Collapse NFC + strip zero-width / BOM noise without touching digits. */
export function normalizeUnicodeNoise(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ');
}

export function normalizeSearchText(value: string): string {
  let out = normalizeUnicodeNoise(String(value ?? ''));
  out = normalizePersianArabicLetters(out);
  out = out.trim().replace(/\s+/g, ' ');
  // Lowercase Latin only — avoid locale surprises on Persian digits/letters.
  out = out.replace(/[A-Za-z]+/g, (chunk) => chunk.toLowerCase());
  return out;
}

/**
 * Tokenize for search. Keeps alphanumerics (Latin + Persian letters + digits).
 * Does not split model numbers glued by hyphens when short (e.g. air-force kept
 * as one token if no spaces); longer hyphenated phrases split on whitespace only.
 */
export function tokenizeSearchText(normalized: string): string[] {
  if (!normalized) return [];
  const parts = normalized
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const part of parts) {
    if (seen.has(part)) continue;
    seen.add(part);
    tokens.push(part);
    if (tokens.length >= SEARCH_MAX_TOKENS) break;
  }
  return tokens;
}

export function normalizeSearchQuery(input: unknown): NormalizedSearchQuery {
  const rawFull = String(input ?? '').trim();
  const raw =
    rawFull.length > SEARCH_MAX_QUERY_LENGTH
      ? rawFull.slice(0, SEARCH_MAX_QUERY_LENGTH)
      : rawFull;
  const normalized = normalizeSearchText(raw);
  return {
    raw,
    normalized,
    tokens: tokenizeSearchText(normalized),
  };
}

/** Bounded Levenshtein — early-exit when distance would exceed max. */
export function boundedLevenshtein(
  a: string,
  b: string,
  maxDistance: number,
): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > maxDistance) return maxDistance + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;

  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[lb];
}

/**
 * Light typo tolerance against a small candidate set (brand aliases).
 * Never run against the full product catalog.
 */
export function lightTypoMatch(
  needle: string,
  candidates: string[],
  options?: { maxDistance?: number; minLength?: number },
): string | null {
  const maxDistance = options?.maxDistance ?? 1;
  const minLength = options?.minLength ?? 3;
  if (!needle || needle.length < minLength) return null;
  let best: string | null = null;
  let bestDist = maxDistance + 1;
  for (const candidate of candidates) {
    if (!candidate) continue;
    // Prefix near-miss: "nik" → "nike" when lengths close.
    if (
      candidate.startsWith(needle) &&
      candidate.length - needle.length <= maxDistance
    ) {
      return candidate;
    }
    if (
      needle.startsWith(candidate) &&
      needle.length - candidate.length <= maxDistance
    ) {
      return candidate;
    }
    const d = boundedLevenshtein(needle, candidate, maxDistance);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
      if (d === 0) return candidate;
    }
  }
  return bestDist <= maxDistance ? best : null;
}

/** Escape LIKE wildcards so user input cannot broaden patterns. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
