export class UnpaidOrderCleanupConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnpaidOrderCleanupConfigError';
  }
}

export interface UnpaidOrderCleanupConfig {
  /** When false, cron no-ops. Default: false (opt-in). */
  enabled: boolean;
  /** Pending orders older than this are eligible. Default: 24 hours. */
  timeoutHours: number;
  /** Max orders processed per cleanup run. Default: 100. */
  batchSize: number;
}

/** Matches historical hardcoded handleDeleteUnpaid threshold. */
export const UNPAID_ORDER_TIMEOUT_HOURS_DEFAULT = 24;
export const UNPAID_ORDER_CLEANUP_BATCH_SIZE_DEFAULT = 100;

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const value =
    raw == null || raw === '' ? fallback : Number(raw);
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new UnpaidOrderCleanupConfigError(
      `${name} must be an integer between ${min} and ${max}`,
    );
  }
  return value;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw === '') {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new UnpaidOrderCleanupConfigError(
    `UNPAID_ORDER_CLEANUP_ENABLED must be a boolean (got "${raw}")`,
  );
}

export function loadUnpaidOrderCleanupConfig(): UnpaidOrderCleanupConfig {
  return {
    enabled: parseBool(process.env.UNPAID_ORDER_CLEANUP_ENABLED, false),
    timeoutHours: parsePositiveInt(
      process.env.UNPAID_ORDER_TIMEOUT_HOURS,
      UNPAID_ORDER_TIMEOUT_HOURS_DEFAULT,
      1,
      24 * 30,
      'UNPAID_ORDER_TIMEOUT_HOURS',
    ),
    batchSize: parsePositiveInt(
      process.env.UNPAID_ORDER_CLEANUP_BATCH_SIZE,
      UNPAID_ORDER_CLEANUP_BATCH_SIZE_DEFAULT,
      1,
      1000,
      'UNPAID_ORDER_CLEANUP_BATCH_SIZE',
    ),
  };
}
