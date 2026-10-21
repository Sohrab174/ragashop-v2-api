import { sanitizeHomeUploadPath } from './storefront-home.validate';

/**
 * Collect `/home/...` paths that are live merchandising assets (public after publish).
 * Skips nested `previousImage` snapshots — those stay draft/restore-only.
 */
export function collectLiveHomeImagePathsFromValue(
  value: unknown,
  out: Set<string> = new Set(),
  skipPreviousImage = true,
): Set<string> {
  if (value == null) return out;
  if (typeof value === 'string') {
    const home = sanitizeHomeUploadPath(value);
    if (home) out.add(home);
    const staticMatch = value.match(/\/static\/home\/([a-zA-Z0-9._-]+)/i);
    if (staticMatch) {
      const logical = sanitizeHomeUploadPath(`/home/${staticMatch[1]}`);
      if (logical) out.add(logical);
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectLiveHomeImagePathsFromValue(item, out, skipPreviousImage);
    }
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (skipPreviousImage && key === 'previousImage') continue;
      collectLiveHomeImagePathsFromValue(child, out, skipPreviousImage);
    }
  }
  return out;
}

export function buildPublishedLiveHomePathSet(options: {
  sectionConfigs?: Array<{ config: unknown }>;
  instanceConfigs?: Array<{ config: unknown }>;
}): Set<string> {
  const out = new Set<string>();
  for (const row of options.sectionConfigs || []) {
    collectLiveHomeImagePathsFromValue(row.config, out, true);
  }
  for (const row of options.instanceConfigs || []) {
    collectLiveHomeImagePathsFromValue(row.config, out, true);
  }
  return out;
}
