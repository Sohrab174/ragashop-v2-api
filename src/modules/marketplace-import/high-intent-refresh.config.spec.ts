import {
  HIGH_INTENT_FRESHNESS_TTL_MS_DEFAULT,
  loadHighIntentRefreshPolicy,
} from './high-intent-refresh.config';

describe('high-intent refresh config', () => {
  const previous = process.env.HIGH_INTENT_FRESHNESS_TTL_MS;

  afterEach(() => {
    if (previous == null) {
      delete process.env.HIGH_INTENT_FRESHNESS_TTL_MS;
    } else {
      process.env.HIGH_INTENT_FRESHNESS_TTL_MS = previous;
    }
  });

  it('defaults to five minutes', () => {
    delete process.env.HIGH_INTENT_FRESHNESS_TTL_MS;
    expect(loadHighIntentRefreshPolicy().freshnessTtlMs).toBe(
      HIGH_INTENT_FRESHNESS_TTL_MS_DEFAULT,
    );
    expect(HIGH_INTENT_FRESHNESS_TTL_MS_DEFAULT).toBe(5 * 60 * 1000);
  });

  it('reads HIGH_INTENT_FRESHNESS_TTL_MS', () => {
    process.env.HIGH_INTENT_FRESHNESS_TTL_MS = '3600000';
    expect(loadHighIntentRefreshPolicy().freshnessTtlMs).toBe(5 * 60 * 1000);
  });
});
