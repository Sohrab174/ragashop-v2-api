import {
  loadUnpaidOrderCleanupConfig,
  UNPAID_ORDER_CLEANUP_BATCH_SIZE_DEFAULT,
  UNPAID_ORDER_TIMEOUT_HOURS_DEFAULT,
  UnpaidOrderCleanupConfigError,
} from './unpaid-order-cleanup.config';

describe('unpaid-order-cleanup.config', () => {
  const prev = {
    enabled: process.env.UNPAID_ORDER_CLEANUP_ENABLED,
    timeout: process.env.UNPAID_ORDER_TIMEOUT_HOURS,
    batch: process.env.UNPAID_ORDER_CLEANUP_BATCH_SIZE,
  };

  afterEach(() => {
    restore('UNPAID_ORDER_CLEANUP_ENABLED', prev.enabled);
    restore('UNPAID_ORDER_TIMEOUT_HOURS', prev.timeout);
    restore('UNPAID_ORDER_CLEANUP_BATCH_SIZE', prev.batch);
  });

  function restore(key: string, value: string | undefined) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  it('defaults to disabled cleanup with 24h timeout and batch 100', () => {
    delete process.env.UNPAID_ORDER_CLEANUP_ENABLED;
    delete process.env.UNPAID_ORDER_TIMEOUT_HOURS;
    delete process.env.UNPAID_ORDER_CLEANUP_BATCH_SIZE;

    const config = loadUnpaidOrderCleanupConfig();
    expect(config.enabled).toBe(false);
    expect(config.timeoutHours).toBe(UNPAID_ORDER_TIMEOUT_HOURS_DEFAULT);
    expect(config.batchSize).toBe(UNPAID_ORDER_CLEANUP_BATCH_SIZE_DEFAULT);
  });

  it('parses enablement and numeric bounds', () => {
    process.env.UNPAID_ORDER_CLEANUP_ENABLED = 'true';
    process.env.UNPAID_ORDER_TIMEOUT_HOURS = '12';
    process.env.UNPAID_ORDER_CLEANUP_BATCH_SIZE = '25';

    expect(loadUnpaidOrderCleanupConfig()).toEqual({
      enabled: true,
      timeoutHours: 12,
      batchSize: 25,
    });
  });

  it('rejects invalid timeout', () => {
    process.env.UNPAID_ORDER_TIMEOUT_HOURS = '0';
    expect(() => loadUnpaidOrderCleanupConfig()).toThrow(
      UnpaidOrderCleanupConfigError,
    );
  });
});
