import {
  SHOWCASE_PILOT_LIVE_ENABLED_ENV,
  SHOWCASE_PILOT_MAX_IDS,
} from './showcase-pilot.constants';
import {
  assertShowcasePilotLiveAllowed,
  isShowcasePilotAllowedSource,
  isShowcasePilotLiveEnabled,
  mapJobStatusToPilotOutcome,
  normalizeShowcasePilotProductIds,
} from './showcase-pilot-refresh.policy';

describe('showcase pilot refresh policy', () => {
  const prev = process.env[SHOWCASE_PILOT_LIVE_ENABLED_ENV];

  afterEach(() => {
    if (prev === undefined) delete process.env[SHOWCASE_PILOT_LIVE_ENABLED_ENV];
    else process.env[SHOWCASE_PILOT_LIVE_ENABLED_ENV] = prev;
  });

  it('enforces exact allowlist normalization and max 40 IDs', () => {
    expect(normalizeShowcasePilotProductIds([1, 2, 2, 3])).toEqual({
      ok: true,
      ids: [1, 2, 3],
    });
    expect(normalizeShowcasePilotProductIds([])).toEqual({
      ok: false,
      error: 'productIds_required',
    });
    expect(normalizeShowcasePilotProductIds([0, 1])).toEqual({
      ok: false,
      error: 'productIds_invalid',
    });
    const tooMany = Array.from({ length: SHOWCASE_PILOT_MAX_IDS + 1 }, (_, i) => i + 1);
    expect(normalizeShowcasePilotProductIds(tooMany)).toEqual({
      ok: false,
      error: `productIds_exceed_max_${SHOWCASE_PILOT_MAX_IDS}`,
    });
  });

  it('defaults live flag off and blocks live without explicit enable', () => {
    delete process.env[SHOWCASE_PILOT_LIVE_ENABLED_ENV];
    expect(isShowcasePilotLiveEnabled()).toBe(false);
    expect(assertShowcasePilotLiveAllowed('live')).toEqual({
      allowed: false,
      blockedReason: `${SHOWCASE_PILOT_LIVE_ENABLED_ENV} is not true (dry-run only)`,
    });
    process.env[SHOWCASE_PILOT_LIVE_ENABLED_ENV] = 'true';
    expect(assertShowcasePilotLiveAllowed('live').allowed).toBe(true);
    expect(assertShowcasePilotLiveAllowed('dry_run').allowed).toBe(false);
  });

  it('allows only trendyol source', () => {
    expect(isShowcasePilotAllowedSource('trendyol')).toBe(true);
    expect(isShowcasePilotAllowedSource('Trendyol')).toBe(true);
    expect(isShowcasePilotAllowedSource('amazon')).toBe(false);
    expect(isShowcasePilotAllowedSource(null)).toBe(false);
  });

  it('maps terminal job statuses for resume reporting', () => {
    expect(mapJobStatusToPilotOutcome('succeeded')).toBe('succeeded');
    expect(mapJobStatusToPilotOutcome('failed')).toBe('failed');
    expect(mapJobStatusToPilotOutcome('queued')).toBe('reused_active');
    expect(mapJobStatusToPilotOutcome('processing')).toBe('reused_active');
    expect(mapJobStatusToPilotOutcome('unknown')).toBeNull();
  });
});
