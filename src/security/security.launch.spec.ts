import {
  createCorsOriginDelegate,
  isSwaggerEnabled,
  resolveAuthRateLimitConfig,
  resolveCorsAllowedOrigins,
  SecurityConfigError,
  validateLaunchSecurityRuntimeConfig,
} from './security-config.util';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { SlidingWindowRateLimiter } from './sliding-window-rate-limiter';

describe('security-config.util', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('CORS', () => {
    it('accepts exact allowlisted origins and rejects others', () => {
      process.env.CORS_ORIGINS =
        'http://127.0.0.1:4445,https://shop.example.com';
      const allowed = resolveCorsAllowedOrigins();
      const decide = createCorsOriginDelegate(allowed);

      const allow = (origin?: string) =>
        new Promise<boolean>((resolve, reject) => {
          decide(origin, (err, ok) => {
            if (err) reject(err);
            else resolve(!!ok);
          });
        });

      return Promise.all([
        expect(allow('http://127.0.0.1:4445')).resolves.toBe(true),
        expect(allow('https://shop.example.com')).resolves.toBe(true),
        expect(allow('https://shop.example.com.attacker.com')).resolves.toBe(
          false,
        ),
        expect(allow('https://evil.com')).resolves.toBe(false),
        expect(allow(undefined)).resolves.toBe(true),
      ]);
    });

    it('fails closed in production when CORS_ORIGINS is missing', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.CORS_ORIGINS;
      expect(() => resolveCorsAllowedOrigins()).toThrow(SecurityConfigError);
    });

    it('uses local development defaults when CORS_ORIGINS unset', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.CORS_ORIGINS;
      process.env.SITE_BASE_URL = 'http://127.0.0.1:4445';
      process.env.PANEL_BASE_URL = 'http://127.0.0.1:4445';

      const origins = resolveCorsAllowedOrigins();
      expect(origins).toContain('http://127.0.0.1:4445');
      expect(origins).toContain('http://localhost:4445');
    });

    it('rejects substring-style deceptive origins via exact match only', () => {
      const decide = createCorsOriginDelegate(['https://trusted.example.com']);
      const allow = (origin: string) =>
        new Promise<boolean>((resolve, reject) => {
          decide(origin, (err, ok) => {
            if (err) reject(err);
            else resolve(!!ok);
          });
        });

      return expect(
        allow('https://trusted.example.attacker.com'),
      ).resolves.toBe(false);
    });
  });

  describe('Swagger', () => {
    it('enables by default outside production', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.SWAGGER_ENABLED;
      expect(isSwaggerEnabled()).toBe(true);
    });

    it('disables by default in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.SWAGGER_ENABLED;
      expect(isSwaggerEnabled()).toBe(false);
    });

    it('honors SWAGGER_ENABLED override', () => {
      process.env.NODE_ENV = 'production';
      process.env.SWAGGER_ENABLED = 'true';
      expect(isSwaggerEnabled()).toBe(true);

      process.env.NODE_ENV = 'development';
      process.env.SWAGGER_ENABLED = 'false';
      expect(isSwaggerEnabled()).toBe(false);
    });
  });

  describe('auth rate-limit config', () => {
    it('loads bounded production-safe defaults', () => {
      delete process.env.AUTH_RATE_LIMIT_LOGIN_MAX_PER_IP;
      const config = resolveAuthRateLimitConfig();
      expect(config.login.maxPerIp).toBeGreaterThan(0);
      expect(config.otpSend.maxPerIdentity).toBeLessThanOrEqual(
        config.otpSend.maxPerIp,
      );
    });

    it('validates launch security config without throwing for development', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.CORS_ORIGINS;
      process.env.SITE_BASE_URL = 'http://127.0.0.1:4445';
      expect(() => validateLaunchSecurityRuntimeConfig()).not.toThrow();
    });
  });
});

describe('AuthRateLimitService', () => {
  it('allows normal traffic then returns false at threshold', () => {
    const now = 1000;
    const service = AuthRateLimitService.createForTests({
      now: () => now,
      maxKeys: 100,
      login: { windowMs: 60000, maxPerIp: 3, maxPerIdentity: 2 },
      otpSend: { windowMs: 60000, maxPerIp: 3, maxPerIdentity: 2 },
      otpVerify: { windowMs: 60000, maxPerIp: 3, maxPerIdentity: 2 },
    });

    expect(service.consume('login', '1.1.1.1', 'user-a')).toBe(true);
    expect(service.consume('login', '1.1.1.1', 'user-a')).toBe(true);
    expect(service.consume('login', '1.1.1.1', 'user-a')).toBe(false);
  });

  it('cannot trivially bypass identity limit by rotating spoofed IPs', () => {
    const service = AuthRateLimitService.createForTests({
      now: () => 1000,
      maxKeys: 100,
      login: { windowMs: 60000, maxPerIp: 100, maxPerIdentity: 2 },
      otpSend: { windowMs: 60000, maxPerIp: 100, maxPerIdentity: 2 },
      otpVerify: { windowMs: 60000, maxPerIp: 100, maxPerIdentity: 2 },
    });

    expect(service.consume('otpVerify', '10.0.0.1', '09000000000')).toBe(true);
    expect(service.consume('otpVerify', '10.0.0.2', '09000000000')).toBe(true);
    expect(service.consume('otpVerify', '10.0.0.3', '09000000000')).toBe(false);
  });

  it('cannot trivially bypass IP limit by rotating identities', () => {
    const service = AuthRateLimitService.createForTests({
      now: () => 1000,
      maxKeys: 100,
      login: { windowMs: 60000, maxPerIp: 2, maxPerIdentity: 100 },
      otpSend: { windowMs: 60000, maxPerIp: 2, maxPerIdentity: 100 },
      otpVerify: { windowMs: 60000, maxPerIp: 2, maxPerIdentity: 100 },
    });

    expect(service.consume('login', '9.9.9.9', 'a@x.com')).toBe(true);
    expect(service.consume('login', '9.9.9.9', 'b@x.com')).toBe(true);
    expect(service.consume('login', '9.9.9.9', 'c@x.com')).toBe(false);
  });

  it('unlocks after window elapses (not permanently locked)', () => {
    let now = 1000;
    const service = AuthRateLimitService.createForTests({
      now: () => now,
      maxKeys: 100,
      login: { windowMs: 1000, maxPerIp: 1, maxPerIdentity: 1 },
      otpSend: { windowMs: 1000, maxPerIp: 1, maxPerIdentity: 1 },
      otpVerify: { windowMs: 1000, maxPerIp: 1, maxPerIdentity: 1 },
    });

    expect(service.consume('otpSend', '1.2.3.4', '09001112233')).toBe(true);
    expect(service.consume('otpSend', '1.2.3.4', '09001112233')).toBe(false);
    now += 2000;
    expect(service.consume('otpSend', '1.2.3.4', '09001112233')).toBe(true);
  });
});

describe('SlidingWindowRateLimiter', () => {
  it('bounds stored keys', () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60000,
      maxRequests: 10,
      maxKeys: 50,
      now: () => 1000,
    });
    for (let i = 0; i < 60; i += 1) {
      limiter.isAllowed(`k-${i}`);
    }
    expect(limiter.getEntryCount()).toBeLessThanOrEqual(50);
  });
});
