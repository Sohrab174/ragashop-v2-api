import {
  SHOWCASE_PILOT_ALLOWED_SOURCE,
  SHOWCASE_PILOT_LIVE_ENABLED_ENV,
  SHOWCASE_PILOT_MAX_IDS,
} from './showcase-pilot.constants';

export type ShowcasePilotMode = 'dry_run' | 'live';

export type ShowcasePilotProductOutcome =
  | 'selected'
  | 'skipped'
  | 'enqueued'
  | 'reused_active'
  | 'succeeded'
  | 'failed';

export function normalizeShowcasePilotProductIds(
  raw: Array<number | string> | null | undefined,
): { ok: true; ids: number[] } | { ok: false; error: string } {
  if (!raw || !Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'productIds_required' };
  }
  if (raw.length > SHOWCASE_PILOT_MAX_IDS) {
    return {
      ok: false,
      error: `productIds_exceed_max_${SHOWCASE_PILOT_MAX_IDS}`,
    };
  }
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const entry of raw) {
    const n = typeof entry === 'number' ? entry : Number(String(entry).trim());
    if (!Number.isInteger(n) || n <= 0) {
      return { ok: false, error: 'productIds_invalid' };
    }
    if (seen.has(n)) continue;
    seen.add(n);
    ids.push(n);
  }
  if (!ids.length) {
    return { ok: false, error: 'productIds_required' };
  }
  if (ids.length > SHOWCASE_PILOT_MAX_IDS) {
    return {
      ok: false,
      error: `productIds_exceed_max_${SHOWCASE_PILOT_MAX_IDS}`,
    };
  }
  return { ok: true, ids };
}

export function isShowcasePilotLiveEnabled(
  raw = process.env[SHOWCASE_PILOT_LIVE_ENABLED_ENV],
): boolean {
  if (raw == null || String(raw).trim() === '') return false;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function assertShowcasePilotLiveAllowed(mode: ShowcasePilotMode): {
  allowed: boolean;
  blockedReason: string | null;
} {
  if (mode !== 'live') {
    return { allowed: false, blockedReason: null };
  }
  if (!isShowcasePilotLiveEnabled()) {
    return {
      allowed: false,
      blockedReason: `${SHOWCASE_PILOT_LIVE_ENABLED_ENV} is not true (dry-run only)`,
    };
  }
  return { allowed: true, blockedReason: null };
}

export function isShowcasePilotAllowedSource(
  source: string | null | undefined,
): boolean {
  return String(source || '').trim().toLowerCase() === SHOWCASE_PILOT_ALLOWED_SOURCE;
}

/**
 * Map terminal marketplace import job status onto pilot outcomes.
 * Active jobs stay as reused_active / enqueued at enqueue time.
 */
export function mapJobStatusToPilotOutcome(
  status: string | null | undefined,
): ShowcasePilotProductOutcome | null {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed') return 'failed';
  if (
    status === 'queued' ||
    status === 'processing' ||
    status === 'retry_wait'
  ) {
    return 'reused_active';
  }
  return null;
}
