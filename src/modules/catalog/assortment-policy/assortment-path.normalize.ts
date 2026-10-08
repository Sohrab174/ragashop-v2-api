/**
 * Deterministic source-path normalization for assortment policy.
 * No LLM, no fuzzy matching, no translation.
 */

/** NFC + trim + Turkish-locale lowercase segment list (empty segments dropped). */
export function normalizePathSegments(path: string): string[] {
  if (path == null || typeof path !== 'string') {
    return [];
  }
  return path
    .normalize('NFC')
    .split('/')
    .map((segment) => segment.trim().toLocaleLowerCase('tr'))
    .filter((segment) => segment.length > 0);
}

/** Stable slash-joined normalized path prefix for storage / selector keys. */
export function normalizePathPrefix(path: string): string {
  return normalizePathSegments(path).join('/');
}

/**
 * Segment-aware prefix match.
 * "giyim" matches "giyim/x" but NOT "giyimm" or "giyim-extra" as a single segment.
 */
export function isSegmentPrefix(
  pathSegments: string[],
  prefixSegments: string[],
): boolean {
  if (prefixSegments.length === 0) {
    return false;
  }
  if (prefixSegments.length > pathSegments.length) {
    return false;
  }
  for (let i = 0; i < prefixSegments.length; i++) {
    if (prefixSegments[i] !== pathSegments[i]) {
      return false;
    }
  }
  return true;
}

export function buildPathSelectorKey(
  provider: string,
  pathPrefixNorm: string,
): string {
  return `path:${provider}:${pathPrefixNorm}`;
}

export function buildCategorySelectorKey(categoryId: number): string {
  return `category:${categoryId}`;
}
