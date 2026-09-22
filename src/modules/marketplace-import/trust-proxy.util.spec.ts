import * as express from 'express';
import * as request from 'supertest';
import { resolveClientIp } from './client-ip.util';
import { MarketplaceImportRateLimiter } from './marketplace-import-rate-limiter';
import { MarketplaceConfigError } from './marketplace-config.util';
import {
  configureExpressTrustProxy,
  parseTrustProxyHops,
  parseTrustProxySetting,
} from './trust-proxy.util';

describe('trust proxy configuration', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to off when unset', () => {
    delete process.env.TRUST_PROXY_MODE;
    delete process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY_HOPS;

    expect(parseTrustProxySetting()).toEqual({ mode: 'off' });
  });

  it('parses TRUST_PROXY_MODE=hops with bounded hop count', () => {
    process.env.TRUST_PROXY_MODE = 'hops';
    process.env.TRUST_PROXY_HOPS = '2';

    expect(parseTrustProxySetting()).toEqual({ mode: 'hops', hops: 2 });
  });

  it('supports legacy TRUST_PROXY=true with default hops', () => {
    delete process.env.TRUST_PROXY_MODE;
    process.env.TRUST_PROXY = 'true';
    delete process.env.TRUST_PROXY_HOPS;

    expect(parseTrustProxySetting()).toEqual({ mode: 'hops', hops: 1 });
  });

  it('rejects invalid hop count values', () => {
    expect(() => parseTrustProxyHops('NaN')).toThrow(MarketplaceConfigError);
    expect(() => parseTrustProxyHops('-1')).toThrow(MarketplaceConfigError);
    expect(() => parseTrustProxyHops('0')).toThrow(MarketplaceConfigError);
    expect(() => parseTrustProxyHops('999')).toThrow(MarketplaceConfigError);
    expect(() => parseTrustProxyHops('abc')).toThrow(MarketplaceConfigError);
  });

  it('rejects invalid TRUST_PROXY_MODE', () => {
    process.env.TRUST_PROXY_MODE = 'always';
    expect(() => parseTrustProxySetting()).toThrow(MarketplaceConfigError);
  });
});

describe('resolveClientIp with Express trust proxy', () => {
  function createIpApp(setting: ReturnType<typeof parseTrustProxySetting>) {
    const app = express();
    configureExpressTrustProxy(app, setting);
    app.get('/ip', (req, res) => {
      res.json({ ip: resolveClientIp(req) });
    });
    return app;
  }

  it('ignores x-forwarded-for when trust proxy is off', async () => {
    const app = createIpApp({ mode: 'off' });
    const response = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '8.8.8.8');

    expect(response.body.ip).not.toBe('8.8.8.8');
    expect(response.body.ip).toMatch(/^127\.0\.0\.1$/);
  });

  it('does not trust attacker-controlled leftmost xff with one trusted hop', async () => {
    const app = createIpApp({ mode: 'hops', hops: 1 });
    const response = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '8.8.8.8, 203.0.113.10');

    expect(response.body.ip).toBe('203.0.113.10');
    expect(response.body.ip).not.toBe('8.8.8.8');
  });

  it('keeps stable identity when attacker rotates leftmost xff values', async () => {
    const app = createIpApp({ mode: 'hops', hops: 1 });
    const limiter = new MarketplaceImportRateLimiter({
      windowMs: 60000,
      maxRequests: 1,
      maxKeys: 100,
      now: () => 1000,
    });

    const first = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '1.1.1.1, 203.0.113.10');
    const second = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '9.9.9.9, 203.0.113.10');

    expect(first.body.ip).toBe('203.0.113.10');
    expect(second.body.ip).toBe('203.0.113.10');

    expect(limiter.isAllowed(first.body.ip)).toBe(true);
    expect(limiter.isAllowed(second.body.ip)).toBe(false);
  });

  it('normalizes IPv4-mapped IPv6 addresses', async () => {
    const app = createIpApp({ mode: 'off' });
    const response = await request(app).get('/ip');

    const req = {
      ip: '::ffff:127.0.0.1',
      socket: { remoteAddress: '::ffff:127.0.0.1' },
    } as any;

    expect(resolveClientIp(req)).toBe('127.0.0.1');
    expect(response.status).toBe(200);
  });
});
