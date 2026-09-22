import { Injectable } from '@nestjs/common';
import {
  AuthRateLimitConfig,
  AuthRateLimitProfile,
  resolveAuthRateLimitConfig,
} from './security-config.util';
import { SlidingWindowRateLimiter } from './sliding-window-rate-limiter';
import { normalizeAuthRateLimitIdentity } from './auth-rate-limit-identity.util';

export type AuthRateLimitKind = 'login' | 'otpSend' | 'otpVerify';

export type AuthRateLimitRuntimeOptions = AuthRateLimitConfig & {
  now?: () => number;
};

function requireLimiter(
  map: Map<AuthRateLimitKind, SlidingWindowRateLimiter>,
  kind: AuthRateLimitKind,
): SlidingWindowRateLimiter {
  const limiter = map.get(kind);
  if (!limiter) {
    throw new Error(`Auth rate limiter missing for kind=${kind}`);
  }
  return limiter;
}

function buildLimiterMaps(options: AuthRateLimitRuntimeOptions): {
  config: AuthRateLimitConfig;
  ipLimiters: Map<AuthRateLimitKind, SlidingWindowRateLimiter>;
  identityLimiters: Map<AuthRateLimitKind, SlidingWindowRateLimiter>;
} {
  const config: AuthRateLimitConfig = {
    login: options.login,
    otpSend: options.otpSend,
    otpVerify: options.otpVerify,
    maxKeys: options.maxKeys,
  };
  const ipLimiters = new Map<AuthRateLimitKind, SlidingWindowRateLimiter>();
  const identityLimiters = new Map<
    AuthRateLimitKind,
    SlidingWindowRateLimiter
  >();
  const now = options.now;

  (['login', 'otpSend', 'otpVerify'] as AuthRateLimitKind[]).forEach((kind) => {
    const profile = config[kind];
    ipLimiters.set(
      kind,
      new SlidingWindowRateLimiter({
        windowMs: profile.windowMs,
        maxRequests: profile.maxPerIp,
        maxKeys: config.maxKeys,
        now,
      }),
    );
    identityLimiters.set(
      kind,
      new SlidingWindowRateLimiter({
        windowMs: profile.windowMs,
        maxRequests: profile.maxPerIdentity,
        maxKeys: config.maxKeys,
        now,
      }),
    );
  });

  return { config, ipLimiters, identityLimiters };
}

/**
 * Nest runtime uses the zero-arg constructor (ENV-backed defaults).
 * Tests that need custom windows/clocks must use createForTests() so Nest
 * never sees an untyped constructor parameter as an injectable Object token.
 */
@Injectable()
export class AuthRateLimitService {
  private readonly config: AuthRateLimitConfig;
  private readonly ipLimiters: Map<AuthRateLimitKind, SlidingWindowRateLimiter>;
  private readonly identityLimiters: Map<
    AuthRateLimitKind,
    SlidingWindowRateLimiter
  >;

  constructor() {
    const built = buildLimiterMaps(resolveAuthRateLimitConfig());
    this.config = built.config;
    this.ipLimiters = built.ipLimiters;
    this.identityLimiters = built.identityLimiters;
  }

  /**
   * Programmatic construction for unit/HTTP specs only.
   * Not used by Nest DI.
   */
  static createForTests(
    options: AuthRateLimitRuntimeOptions,
  ): AuthRateLimitService {
    const built = buildLimiterMaps(options);
    const service = Object.create(
      AuthRateLimitService.prototype,
    ) as AuthRateLimitService;
    Object.defineProperties(service, {
      config: { value: built.config, enumerable: true },
      ipLimiters: { value: built.ipLimiters, enumerable: true },
      identityLimiters: { value: built.identityLimiters, enumerable: true },
    });
    return service;
  }

  /**
   * Returns true when both IP and identity dimensions are within limits.
   * Identity key is always consumed (even for unknown accounts) to avoid
   * materially different throttle timing that could leak account existence.
   *
   * @param fieldHint optional body field name (`mobile`, `email`,
   * `emailOrMobile`) so phone vs email semantics stay correct.
   */
  consume(
    kind: AuthRateLimitKind,
    ip: string,
    identity: string,
    fieldHint?: string,
  ): boolean {
    const ipKey = `ip:${kind}:${ip || 'unknown'}`;
    const identityKey = `id:${kind}:${normalizeAuthRateLimitIdentity(
      identity,
      fieldHint,
    )}`;

    const ipAllowed = requireLimiter(this.ipLimiters, kind).isAllowed(ipKey);
    const identityAllowed = requireLimiter(
      this.identityLimiters,
      kind,
    ).isAllowed(identityKey);

    return ipAllowed && identityAllowed;
  }

  getProfile(kind: AuthRateLimitKind): AuthRateLimitProfile {
    return this.config[kind];
  }

  reset(): void {
    for (const limiter of this.ipLimiters.values()) {
      limiter.reset();
    }
    for (const limiter of this.identityLimiters.values()) {
      limiter.reset();
    }
  }
}
