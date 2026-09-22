import {
  createCorsOriginDelegate,
  isSwaggerEnabled,
  resolveCorsAllowedOrigins,
  SecurityConfigError,
  validateLaunchSecurityRuntimeConfig,
} from './security-config.util';
import { createHelmetMiddleware } from './helmet.util';
import { parseTrustProxySetting } from '../modules/marketplace-import/trust-proxy.util';

/**
 * Lightweight adversarial checks for launch security fail-closed behavior.
 */
describe('launch security adversarial checks', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects deceptive sibling origins that only share a suffix', () => {
    const decide = createCorsOriginDelegate([
      'https://trusted.example.com',
      'http://127.0.0.1:4445',
    ]);
    const check = (origin: string) =>
      new Promise<boolean>((resolve, reject) => {
        decide(origin, (err, ok) => (err ? reject(err) : resolve(!!ok)));
      });

    return Promise.all([
      expect(check('https://trusted.example.attacker.com')).resolves.toBe(
        false,
      ),
      expect(check('https://evil-127.0.0.1:4445')).resolves.toBe(false),
      expect(check('http://127.0.0.1:4445.evil.com')).resolves.toBe(false),
      expect(check('http://127.0.0.1:4445')).resolves.toBe(true),
    ]);
  });

  it('production without CORS_ORIGINS cannot start security validation', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGINS;
    expect(() => validateLaunchSecurityRuntimeConfig()).toThrow(
      SecurityConfigError,
    );
  });

  it('production swagger remains off unless explicitly enabled', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SWAGGER_ENABLED;
    expect(isSwaggerEnabled()).toBe(false);
  });

  it('trust proxy stays off by default so XFF cannot choose identity', () => {
    delete process.env.TRUST_PROXY_MODE;
    delete process.env.TRUST_PROXY;
    expect(parseTrustProxySetting()).toEqual({ mode: 'off' });
  });

  it('helmet middleware factory loads for API and swagger modes', () => {
    expect(() =>
      createHelmetMiddleware({
        swaggerEnabled: false,
        env: { NODE_ENV: 'production' },
      }),
    ).not.toThrow();
    expect(() =>
      createHelmetMiddleware({
        swaggerEnabled: true,
        env: { NODE_ENV: 'development' },
      }),
    ).not.toThrow();
  });

  it('local development origins resolve for ragashop-site ports', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CORS_ORIGINS;
    process.env.SITE_BASE_URL = 'http://127.0.0.1:4445';
    const origins = resolveCorsAllowedOrigins();
    expect(origins).toEqual(
      expect.arrayContaining([
        'http://127.0.0.1:4445',
        'http://localhost:4445',
      ]),
    );
  });
});
