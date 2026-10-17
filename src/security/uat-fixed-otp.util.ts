/**
 * Isolated-UAT fixed OTP gate.
 *
 * Enables OTP `11111` for every destination only when ALL fail-closed
 * conditions match an isolated UAT database. Production / local
 * development / staging SMS behaviour is unchanged when the flag is off.
 *
 * Required together:
 * - UAT_FIXED_OTP=1
 * - DATABASE_NAME equals UAT_REQUIRED_DATABASE_NAME (default ragashop_v2_uat)
 * - DEPLOY_ENV=uat
 *
 * Launch validation refuses to start when UAT_FIXED_OTP is enabled without
 * the matching database / deploy env. Secrets are never echoed.
 */

export const UAT_FIXED_OTP_ENV = 'UAT_FIXED_OTP';
export const UAT_REQUIRED_DATABASE_NAME_ENV = 'UAT_REQUIRED_DATABASE_NAME';
export const DEFAULT_UAT_DATABASE_NAME = 'ragashop_v2_uat';
export const DEPLOY_ENV_KEY = 'DEPLOY_ENV';
export const UAT_DEPLOY_ENV_VALUE = 'uat';

export class UatFixedOtpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UatFixedOtpConfigError';
  }
}

function isExactOne(raw: string | undefined): boolean {
  return raw === '1';
}

export function resolveUatRequiredDatabaseName(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = String(env[UAT_REQUIRED_DATABASE_NAME_ENV] || '')
    .trim()
    .toLowerCase();
  return configured || DEFAULT_UAT_DATABASE_NAME;
}

export function isUatDeployEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    String(env[DEPLOY_ENV_KEY] || '')
      .trim()
      .toLowerCase() === UAT_DEPLOY_ENV_VALUE
  );
}

/**
 * True only for the isolated UAT runtime. Never enabled by NODE_ENV alone.
 */
export function isUatFixedOtpEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isExactOne(env[UAT_FIXED_OTP_ENV])) {
    return false;
  }
  if (!isUatDeployEnv(env)) {
    return false;
  }
  const databaseName = String(env.DATABASE_NAME || '')
    .trim()
    .toLowerCase();
  if (!databaseName) {
    return false;
  }
  return databaseName === resolveUatRequiredDatabaseName(env);
}

/**
 * Fail closed at process boot when the UAT OTP flag is set incorrectly.
 * Skips when NODE_ENV=test so Jest can exercise the pure helpers.
 */
export function validateUatFixedOtpRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV === 'test' || env.JEST_WORKER_ID) {
    return;
  }

  if (!isExactOne(env[UAT_FIXED_OTP_ENV])) {
    return;
  }

  const failures: string[] = [];

  if (!isUatDeployEnv(env)) {
    failures.push(`${DEPLOY_ENV_KEY} must be exactly '${UAT_DEPLOY_ENV_VALUE}'`);
  }

  const databaseName = String(env.DATABASE_NAME || '').trim();
  const required = resolveUatRequiredDatabaseName(env);
  if (!databaseName || databaseName.toLowerCase() !== required) {
    failures.push(
      `DATABASE_NAME must equal isolated UAT database '${required}'`,
    );
  }

  // Guard against accidentally enabling fixed OTP against a non-UAT name
  // that someone renamed via UAT_REQUIRED_DATABASE_NAME to a prod-like value.
  if (required === 'ragashop' || required.endsWith('_prod')) {
    failures.push(
      `${UAT_REQUIRED_DATABASE_NAME_ENV} rejects production-like names`,
    );
  }

  if (failures.length > 0) {
    throw new UatFixedOtpConfigError(
      `UAT fixed OTP configuration invalid: ${failures.join('; ')}. ` +
        `Fixed OTP 11111 is refused outside the isolated UAT database.`,
    );
  }
}
