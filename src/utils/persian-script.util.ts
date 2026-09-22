/**
 * App-side Persian/Arabic script detection.
 * Avoids MySQL PCRE2 REGEXP with unsupported JS-style \\uXXXX escapes.
 */
const PERSIAN_ARABIC_SCRIPT_RE = /[\u0600-\u06FF]/;

export function containsPersianScript(
  text: string | null | undefined,
): boolean {
  return typeof text === 'string' && PERSIAN_ARABIC_SCRIPT_RE.test(text);
}

/** First row whose `name`/`content` field contains Persian script, or undefined. */
export function pickFirstPersianTextRow<T extends Record<string, unknown>>(
  rows: T[] | null | undefined,
  field: keyof T = 'name' as keyof T,
): T | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  return rows.find((row) => containsPersianScript(String(row?.[field] ?? '')));
}
