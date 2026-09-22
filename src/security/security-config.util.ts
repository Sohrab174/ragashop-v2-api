export class SecurityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityConfigError';
  }
}

export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

export function parseBooleanEnv(
  raw: string | undefined,
  fallback: boolean,
): boolean {
  if (raw == null || raw.trim() === '') {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new SecurityConfigError(
    `Invalid boolean env value "${raw}" (expected true/false)`,
  );
}

export function parsePositiveIntEnv(
  raw: string | number | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const value =
    raw == null || raw === ''
      ? fallback
      : typeof raw === 'number'
      ? raw
      : Number(raw);
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new SecurityConfigError(
      `${name} must be an integer between ${min} and ${max}`,
    );
  }
  return value;
}

/**
 * Exact-match CORS allowlist.
 * Production fails closed when CORS_ORIGINS is missing/empty.
 * Non-production falls back to SITE_BASE_URL / PANEL_BASE_URL / local ragashop-site ports.
 */
export function resolveCorsAllowedOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const fromEnv = (env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (fromEnv.length > 0) {
    for (const origin of fromEnv) {
      assertExactOrigin(origin);
    }
    return Array.from(new Set(fromEnv));
  }

  if (isProductionEnv(env)) {
    throw new SecurityConfigError(
      'CORS_ORIGINS is required in production (comma-separated exact origins)',
    );
  }

  const defaults = [
    env.SITE_BASE_URL,
    env.PANEL_BASE_URL,
    'http://127.0.0.1:4445',
    'http://localhost:4445',
  ]
    .map((origin) => (origin || '').trim())
    .filter(Boolean);

  for (const origin of defaults) {
    assertExactOrigin(origin);
  }

  return Array.from(new Set(defaults));
}

function assertExactOrigin(origin: string): void {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new SecurityConfigError(
      `Invalid CORS origin "${origin}" (must be absolute URL)`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new SecurityConfigError(
      `Invalid CORS origin "${origin}" (credentials not allowed)`,
    );
  }

  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new SecurityConfigError(
      `Invalid CORS origin "${origin}" (origin must not include path/query/hash)`,
    );
  }

  // Reconstruct canonical origin (scheme + host + optional port only).
  if (
    parsed.origin !== origin &&
    `${parsed.protocol}//${parsed.host}` !== origin
  ) {
    throw new SecurityConfigError(
      `Invalid CORS origin "${origin}" (must be exact origin form)`,
    );
  }
}

export function createCorsOriginDelegate(
  allowedOrigins: string[],
): (
  requestOrigin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) => void {
  const allowlist = new Set(allowedOrigins);

  return (requestOrigin, callback) => {
    // Non-browser / same-origin tooling often omits Origin.
    if (!requestOrigin) {
      callback(null, true);
      return;
    }

    if (allowlist.has(requestOrigin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  };
}

/**
 * Swagger is enabled by default outside production; disabled by default in production.
 * SWAGGER_ENABLED overrides the default when set.
 */
export function isSwaggerEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const production = isProductionEnv(env);
  return parseBooleanEnv(env.SWAGGER_ENABLED, !production);
}

export type AuthRateLimitProfile = {
  windowMs: number;
  maxPerIp: number;
  maxPerIdentity: number;
};

export type AuthRateLimitConfig = {
  login: AuthRateLimitProfile;
  otpSend: AuthRateLimitProfile;
  otpVerify: AuthRateLimitProfile;
  maxKeys: number;
};

export function resolveAuthRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env,
): AuthRateLimitConfig {
  return {
    login: {
      windowMs: parsePositiveIntEnv(
        env.AUTH_RATE_LIMIT_LOGIN_WINDOW_MS,
        60_000,
        1_000,
        3_600_000,
        'AUTH_RATE_LIMIT_LOGIN_WINDOW_MS',
      ),
      maxPerIp: parsePositiveIntEnv(
        env.AUTH_RATE_LIMIT_LOGIN_MAX_PER_IP,
        20,
        1,
        1_000,
        'AUTH_RATE_LIMIT_LOGIN_MAX_PER_IP',
      ),
      maxPerIdentity: parsePositiveIntEnv(
        env.AUTH_RATE_LIMIT_LOGIN_MAX_PER_IDENTITY,
        10,
        1,
        1_000,
        'AUTH_RATE_LIMIT_LOGIN_MAX_PER_IDENTITY',
      ),
    },
    otpSend: {
      windowMs: parsePositiveIntEnv(
        env.AUTH_RATE_LIMIT_OTP_SEND_WINDOW_MS,
        60_000,
        1_000,
        3_600_000,
        'AUTH_RATE_LIMIT_OTP_SEND_WINDOW_MS',
      ),
      maxPerIp: parsePositiveIntEnv(
        env.AUTH_RATE_LIMIT_OTP_SEND_MAX_PER_IP,
        10,
        1,
        1_000,
        'AUTH_RATE_LIMIT_OTP_SEND_MAX_PER_IP',
      ),
      maxPerIdentity: parsePositiveIntEnv(
        env.AUTH_RATE_LIMIT_OTP_SEND_MAX_PER_IDENTITY,
        3,
        1,
        1_000,
        'AUTH_RATE_LIMIT_OTP_SEND_MAX_PER_IDENTITY',
      ),
    },
    otpVerify: {
      windowMs: parsePositiveIntEnv(
        env.AUTH_RATE_LIMIT_OTP_VERIFY_WINDOW_MS,
        60_000,
        1_000,
        3_600_000,
        'AUTH_RATE_LIMIT_OTP_VERIFY_WINDOW_MS',
      ),
      maxPerIp: parsePositiveIntEnv(
        env.AUTH_RATE_LIMIT_OTP_VERIFY_MAX_PER_IP,
        30,
        1,
        1_000,
        'AUTH_RATE_LIMIT_OTP_VERIFY_MAX_PER_IP',
      ),
      maxPerIdentity: parsePositiveIntEnv(
        env.AUTH_RATE_LIMIT_OTP_VERIFY_MAX_PER_IDENTITY,
        10,
        1,
        1_000,
        'AUTH_RATE_LIMIT_OTP_VERIFY_MAX_PER_IDENTITY',
      ),
    },
    maxKeys: parsePositiveIntEnv(
      env.AUTH_RATE_LIMIT_MAX_KEYS,
      20_000,
      100,
      200_000,
      'AUTH_RATE_LIMIT_MAX_KEYS',
    ),
  };
}

export function validateLaunchSecurityRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): void {
  resolveCorsAllowedOrigins(env);
  isSwaggerEnabled(env);
  resolveAuthRateLimitConfig(env);
}
