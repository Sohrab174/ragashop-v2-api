import { Readable } from 'stream';
import {
  destroyResponseStream,
  MarketplaceRedirectError,
  MarketplaceRedirectResolver,
} from './marketplace-redirect.resolver';

describe('MarketplaceRedirectResolver', () => {
  const productUrl = 'https://www.trendyol.com/brand/some-product-p-1234567';

  const publicDns = jest
    .fn()
    .mockResolvedValue([{ address: '1.2.3.4', family: 4 }]);

  beforeEach(() => {
    publicDns.mockClear();
    publicDns.mockResolvedValue([{ address: '1.2.3.4', family: 4 }]);
  });

  function createMockStream() {
    const stream = new Readable({ read() {} });
    const destroySpy = jest.spyOn(stream, 'destroy');
    return { stream, destroySpy };
  }

  it('accepts ty.gl -> trendyol redirect', async () => {
    const resolver = new MarketplaceRedirectResolver({
      resolveDns: publicDns,
      httpHead: jest.fn().mockImplementation(async (url: string) => {
        if (url.includes('ty.gl')) {
          return {
            status: 302,
            headers: { location: productUrl },
          };
        }
        return { status: 200, headers: {} };
      }),
    });

    const identity = await resolver.resolveTyGlToIdentity('https://ty.gl/abc');
    expect(identity.sourceProductId).toBe('1234567');
    expect(publicDns).toHaveBeenCalledWith('ty.gl', expect.anything());
    expect(publicDns).toHaveBeenCalledWith(
      'www.trendyol.com',
      expect.anything(),
    );
  });

  it('falls back to exactly one GET when HEAD returns 405', async () => {
    const httpHead = jest.fn().mockResolvedValue({ status: 405, headers: {} });
    const { stream, destroySpy } = createMockStream();
    const httpGet = jest.fn().mockResolvedValue({
      status: 302,
      headers: { location: productUrl },
      data: stream,
    });

    const resolver = new MarketplaceRedirectResolver({
      resolveDns: publicDns,
      httpHead,
      httpGet,
    });

    const identity = await resolver.resolveTyGlToIdentity('https://ty.gl/abc');
    expect(identity.sourceProductId).toBe('1234567');
    expect(httpHead).toHaveBeenCalledTimes(1);
    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(destroySpy).toHaveBeenCalled();
  });

  it('falls back to exactly one GET when HEAD returns 501', async () => {
    const httpHead = jest.fn().mockResolvedValue({ status: 501, headers: {} });
    const { stream, destroySpy } = createMockStream();
    const httpGet = jest.fn().mockResolvedValue({
      status: 302,
      headers: { location: productUrl },
      data: stream,
    });

    const resolver = new MarketplaceRedirectResolver({
      resolveDns: publicDns,
      httpHead,
      httpGet,
    });

    await resolver.resolveTyGlToIdentity('https://ty.gl/abc');
    expect(httpHead).toHaveBeenCalledTimes(1);
    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(destroySpy).toHaveBeenCalled();
  });

  it('does not call GET when HEAD times out', async () => {
    const httpHead = jest
      .fn()
      .mockRejectedValue(new Error('timeout of 1000ms exceeded'));
    const httpGet = jest.fn();

    const resolver = new MarketplaceRedirectResolver({
      resolveDns: publicDns,
      httpHead,
      httpGet,
    });

    await expect(
      resolver.resolveTyGlToIdentity('https://ty.gl/abc'),
    ).rejects.toMatchObject({ code: 'REDIRECT_TIMEOUT' });
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('does not call GET when HEAD has TLS/network error', async () => {
    const httpHead = jest
      .fn()
      .mockRejectedValue(new Error('TLS handshake failed'));
    const httpGet = jest.fn();

    const resolver = new MarketplaceRedirectResolver({
      resolveDns: publicDns,
      httpHead,
      httpGet,
    });

    await expect(
      resolver.resolveTyGlToIdentity('https://ty.gl/abc'),
    ).rejects.toMatchObject({ code: 'REDIRECT_FAILED' });
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('does not call GET when HEAD connection is refused', async () => {
    const httpHead = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const httpGet = jest.fn();

    const resolver = new MarketplaceRedirectResolver({
      resolveDns: publicDns,
      httpHead,
      httpGet,
    });

    await expect(
      resolver.resolveTyGlToIdentity('https://ty.gl/abc'),
    ).rejects.toMatchObject({ code: 'REDIRECT_FAILED' });
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('destroys GET stream on redirect response', async () => {
    const httpHead = jest.fn().mockResolvedValue({ status: 405, headers: {} });
    const { stream, destroySpy } = createMockStream();
    const httpGet = jest.fn().mockResolvedValue({
      status: 302,
      headers: { location: productUrl },
      data: stream,
    });

    const resolver = new MarketplaceRedirectResolver({
      resolveDns: publicDns,
      httpHead,
      httpGet,
    });

    await resolver.resolveTyGlToIdentity('https://ty.gl/abc');
    expect(destroySpy).toHaveBeenCalled();
  });

  it('destroys GET stream on terminal response', async () => {
    const httpHead = jest.fn().mockResolvedValue({ status: 405, headers: {} });
    const { stream, destroySpy } = createMockStream();
    const httpGet = jest.fn().mockResolvedValue({
      status: 200,
      headers: {},
      data: stream,
    });

    const resolver = new MarketplaceRedirectResolver({
      resolveDns: publicDns,
      httpHead,
      httpGet,
    });

    await expect(
      resolver.resolveTyGlToIdentity('https://ty.gl/abc'),
    ).rejects.toBeInstanceOf(MarketplaceRedirectError);
    expect(destroySpy).toHaveBeenCalled();
  });

  it('destroys GET stream when Location is malformed', async () => {
    const httpHead = jest.fn().mockResolvedValue({ status: 405, headers: {} });
    const { stream, destroySpy } = createMockStream();
    const httpGet = jest.fn().mockResolvedValue({
      status: 302,
      headers: { location: 'http://evil.com/x' },
      data: stream,
    });

    const resolver = new MarketplaceRedirectResolver({
      resolveDns: publicDns,
      httpHead,
      httpGet,
    });

    await expect(
      resolver.resolveTyGlToIdentity('https://ty.gl/abc'),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MARKETPLACE' });
    expect(destroySpy).toHaveBeenCalled();
  });

  it('terminates on slow DNS within total deadline', async () => {
    const slowDns = jest.fn(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([{ address: '1.2.3.4', family: 4 }]), 500);
        }),
    ) as any;

    const resolver = new MarketplaceRedirectResolver({
      totalTimeoutMs: 50,
      resolveDns: slowDns,
      httpHead: jest.fn(),
    });

    await expect(
      resolver.resolveTyGlToIdentity('https://ty.gl/abc'),
    ).rejects.toMatchObject({ code: 'REDIRECT_TIMEOUT' });
    expect(slowDns).toHaveBeenCalled();
  });

  it('fails closed on DNS resolution failure', async () => {
    const resolver = new MarketplaceRedirectResolver({
      resolveDns: jest.fn().mockRejectedValue(new Error('ENOTFOUND')),
      httpHead: jest.fn(),
    });

    await expect(
      resolver.resolveTyGlToIdentity('https://ty.gl/abc'),
    ).rejects.toMatchObject({ code: 'PRIVATE_DESTINATION' });
  });

  it('rejects mixed public and private DNS results', async () => {
    const resolver = new MarketplaceRedirectResolver({
      resolveDns: jest.fn().mockResolvedValue([
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
      httpHead: jest.fn(),
    });

    await expect(
      resolver.resolveTyGlToIdentity('https://ty.gl/abc'),
    ).rejects.toMatchObject({ code: 'PRIVATE_DESTINATION' });
  });

  it('terminates on redirect loop', async () => {
    const resolver = new MarketplaceRedirectResolver({
      resolveDns: publicDns,
      httpHead: jest.fn().mockResolvedValue({
        status: 302,
        headers: { location: 'https://ty.gl/loop' },
      }),
    });

    await expect(
      resolver.resolveTyGlToIdentity('https://ty.gl/loop'),
    ).rejects.toMatchObject({ code: 'REDIRECT_CHAIN_TOO_LONG' });
  });

  it('terminates on excessive hops', async () => {
    const resolver = new MarketplaceRedirectResolver({
      maxRedirects: 0,
      totalTimeoutMs: 10000,
      resolveDns: publicDns,
      httpHead: jest.fn().mockResolvedValue({
        status: 302,
        headers: { location: 'https://ty.gl/next' },
      }),
    });

    await expect(
      resolver.resolveTyGlToIdentity('https://ty.gl/start'),
    ).rejects.toMatchObject({ code: 'REDIRECT_CHAIN_TOO_LONG' });
  });

  it('rejects HTTP downgrade via Location', async () => {
    const resolver = new MarketplaceRedirectResolver({
      resolveDns: publicDns,
      httpHead: jest.fn().mockResolvedValue({
        status: 302,
        headers: { location: 'http://www.trendyol.com/x-p-1' },
      }),
    });

    await expect(
      resolver.resolveTyGlToIdentity('https://ty.gl/abc'),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MARKETPLACE' });
  });

  it('rejects ty.gl -> external host', async () => {
    const resolver = new MarketplaceRedirectResolver({
      resolveDns: publicDns,
      httpHead: jest.fn().mockResolvedValue({
        status: 302,
        headers: { location: 'https://evil.com/x-p-1' },
      }),
    });

    await expect(
      resolver.resolveTyGlToIdentity('https://ty.gl/abc'),
    ).rejects.toBeInstanceOf(MarketplaceRedirectError);
  });

  it('fails safely on overall redirect deadline during hops', async () => {
    let now = 1000;
    const resolver = new MarketplaceRedirectResolver({
      totalTimeoutMs: 50,
      hopTimeoutMs: 1000,
      now: () => now,
      resolveDns: publicDns,
      httpHead: jest.fn().mockImplementation(async () => {
        now += 100;
        return {
          status: 302,
          headers: { location: 'https://ty.gl/loop' },
        };
      }),
    });

    await expect(
      resolver.resolveTyGlToIdentity('https://ty.gl/abc'),
    ).rejects.toMatchObject({ code: 'REDIRECT_TIMEOUT' });
  });

  it('does not download final Trendyol page body', async () => {
    const httpHead = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('ty.gl')) {
        return {
          status: 302,
          headers: { location: productUrl },
        };
      }
      return { status: 200, headers: {} };
    });
    const httpGet = jest.fn();

    const resolver = new MarketplaceRedirectResolver({
      resolveDns: publicDns,
      httpHead,
      httpGet,
    });

    await resolver.resolveTyGlToIdentity('https://ty.gl/abc');
    expect(httpGet).not.toHaveBeenCalled();
    expect(httpHead).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized GET fallback bodies', async () => {
    const resolver = new MarketplaceRedirectResolver({
      resolveDns: publicDns,
      httpHead: jest.fn().mockResolvedValue({ status: 405, headers: {} }),
      httpGet: jest
        .fn()
        .mockRejectedValue(new Error('maxContentLength size exceeded')),
    });

    await expect(
      resolver.resolveTyGlToIdentity('https://ty.gl/abc'),
    ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });

  describe('shared absolute deadline (Fix Pass #3)', () => {
    it('GET fallback receives only remaining budget after slow HEAD 405', async () => {
      let now = 1000;
      const httpHead = jest
        .fn()
        .mockImplementation(
          async (_url: string, config: { timeout: number }) => {
            expect(config.timeout).toBe(1000);
            now += 900;
            return { status: 405, headers: {} };
          },
        );
      const { stream } = createMockStream();
      const httpGet = jest
        .fn()
        .mockImplementation(
          async (_url: string, config: { timeout: number }) => {
            expect(config.timeout).toBeLessThanOrEqual(100);
            expect(config.timeout).toBeGreaterThan(0);
            return {
              status: 302,
              headers: { location: productUrl },
              data: stream,
            };
          },
        );

      const resolver = new MarketplaceRedirectResolver({
        totalTimeoutMs: 1000,
        hopTimeoutMs: 1000,
        now: () => now,
        resolveDns: publicDns,
        httpHead,
        httpGet,
      });

      await resolver.resolveTyGlToIdentity('https://ty.gl/abc');
      expect(httpGet).toHaveBeenCalledTimes(1);
    });

    it('does not call GET when HEAD 405 returns after deadline is exhausted', async () => {
      let now = 1000;
      const httpHead = jest.fn().mockImplementation(async () => {
        now += 1001;
        return { status: 405, headers: {} };
      });
      const httpGet = jest.fn();

      const resolver = new MarketplaceRedirectResolver({
        totalTimeoutMs: 1000,
        hopTimeoutMs: 1000,
        now: () => now,
        resolveDns: publicDns,
        httpHead,
        httpGet,
      });

      await expect(
        resolver.resolveTyGlToIdentity('https://ty.gl/abc'),
      ).rejects.toMatchObject({ code: 'REDIRECT_TIMEOUT' });
      expect(httpGet).not.toHaveBeenCalled();
    });

    it('HEAD and GET combined cannot exceed total deadline budget', async () => {
      let now = 1000;
      let headTimeoutUsed = 0;
      let getTimeoutUsed = 0;

      const httpHead = jest
        .fn()
        .mockImplementation(
          async (_url: string, config: { timeout: number }) => {
            headTimeoutUsed = config.timeout;
            now += 700;
            return { status: 405, headers: {} };
          },
        );
      const { stream } = createMockStream();
      const httpGet = jest
        .fn()
        .mockImplementation(
          async (_url: string, config: { timeout: number }) => {
            getTimeoutUsed = config.timeout;
            return {
              status: 302,
              headers: { location: productUrl },
              data: stream,
            };
          },
        );

      const resolver = new MarketplaceRedirectResolver({
        totalTimeoutMs: 1000,
        hopTimeoutMs: 1000,
        now: () => now,
        resolveDns: publicDns,
        httpHead,
        httpGet,
      });

      await resolver.resolveTyGlToIdentity('https://ty.gl/abc');
      expect(headTimeoutUsed).toBe(1000);
      expect(getTimeoutUsed).toBeLessThanOrEqual(300);
      expect(getTimeoutUsed).toBeGreaterThan(0);
    });
  });

  describe('final canonical Trendyol DNS validation (Fix Pass #3)', () => {
    it('DNS-validates both ty.gl and final www.trendyol.com hostnames', async () => {
      const resolveDns = jest.fn().mockImplementation(async (host: string) => {
        return [{ address: '1.2.3.4', family: 4 }];
      });
      const httpHead = jest.fn().mockResolvedValue({
        status: 302,
        headers: { location: productUrl },
      });

      const resolver = new MarketplaceRedirectResolver({
        resolveDns,
        httpHead,
      });

      await resolver.resolveTyGlToIdentity('https://ty.gl/abc');

      const hosts = resolveDns.mock.calls.map((call) => call[0]);
      expect(hosts).toContain('ty.gl');
      expect(hosts).toContain('www.trendyol.com');
    });

    it('fails closed when final Trendyol hostname resolves to private IP', async () => {
      const resolveDns = jest.fn().mockImplementation(async (host: string) => {
        if (host === 'ty.gl') {
          return [{ address: '1.2.3.4', family: 4 }];
        }
        return [{ address: '127.0.0.1', family: 4 }];
      });
      const httpHead = jest.fn().mockResolvedValue({
        status: 302,
        headers: { location: productUrl },
      });
      const httpGet = jest.fn();

      const resolver = new MarketplaceRedirectResolver({
        resolveDns,
        httpHead,
        httpGet,
      });

      await expect(
        resolver.resolveTyGlToIdentity('https://ty.gl/abc'),
      ).rejects.toMatchObject({ code: 'PRIVATE_DESTINATION' });
      expect(httpHead).toHaveBeenCalledTimes(1);
      expect(httpHead).not.toHaveBeenCalledWith(
        expect.stringContaining('trendyol.com'),
        expect.anything(),
      );
      expect(httpGet).not.toHaveBeenCalled();
    });

    it('fails closed when final Trendyol hostname has mixed public and private DNS', async () => {
      const resolveDns = jest.fn().mockImplementation(async (host: string) => {
        if (host === 'ty.gl') {
          return [{ address: '1.2.3.4', family: 4 }];
        }
        return [
          { address: '8.8.8.8', family: 4 },
          { address: '10.0.0.1', family: 4 },
        ];
      });
      const httpHead = jest.fn().mockResolvedValue({
        status: 302,
        headers: { location: productUrl },
      });
      const httpGet = jest.fn();

      const resolver = new MarketplaceRedirectResolver({
        resolveDns,
        httpHead,
        httpGet,
      });

      await expect(
        resolver.resolveTyGlToIdentity('https://ty.gl/abc'),
      ).rejects.toMatchObject({ code: 'PRIVATE_DESTINATION' });
      expect(httpGet).not.toHaveBeenCalled();
      expect(httpHead).not.toHaveBeenCalledWith(
        expect.stringContaining('trendyol.com'),
        expect.anything(),
      );
    });

    it('fails when final Trendyol DNS lookup throws', async () => {
      const resolveDns = jest.fn().mockImplementation(async (host: string) => {
        if (host === 'ty.gl') {
          return [{ address: '1.2.3.4', family: 4 }];
        }
        throw new Error('ENOTFOUND');
      });
      const httpHead = jest.fn().mockResolvedValue({
        status: 302,
        headers: { location: productUrl },
      });
      const httpGet = jest.fn();

      const resolver = new MarketplaceRedirectResolver({
        resolveDns,
        httpHead,
        httpGet,
      });

      await expect(
        resolver.resolveTyGlToIdentity('https://ty.gl/abc'),
      ).rejects.toMatchObject({ code: 'PRIVATE_DESTINATION' });
      expect(httpGet).not.toHaveBeenCalled();
      expect(httpHead).not.toHaveBeenCalledWith(
        expect.stringContaining('trendyol.com'),
        expect.anything(),
      );
    });

    it('times out final Trendyol DNS when total deadline is nearly exhausted', async () => {
      let now = 1000;
      const resolveDns = jest.fn().mockImplementation(async (host: string) => {
        if (host === 'ty.gl') {
          return [{ address: '1.2.3.4', family: 4 }];
        }
        return new Promise(() => {});
      });
      const httpHead = jest.fn().mockImplementation(async () => {
        now += 990;
        return {
          status: 302,
          headers: { location: productUrl },
        };
      });
      const httpGet = jest.fn();

      const resolver = new MarketplaceRedirectResolver({
        totalTimeoutMs: 1000,
        hopTimeoutMs: 1000,
        now: () => now,
        resolveDns,
        httpHead,
        httpGet,
      });

      await expect(
        resolver.resolveTyGlToIdentity('https://ty.gl/abc'),
      ).rejects.toMatchObject({ code: 'REDIRECT_TIMEOUT' });
      expect(httpGet).not.toHaveBeenCalled();
      expect(httpHead).not.toHaveBeenCalledWith(
        expect.stringContaining('trendyol.com'),
        expect.anything(),
      );
    });

    it('returns canonical identity without fetching final Trendyol page', async () => {
      const resolveDns = jest.fn().mockImplementation(async (host: string) => {
        return [{ address: '1.2.3.4', family: 4 }];
      });
      const httpHead = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes('ty.gl')) {
          return {
            status: 302,
            headers: { location: productUrl },
          };
        }
        throw new Error('final Trendyol page must not be fetched');
      });
      const httpGet = jest.fn();

      const resolver = new MarketplaceRedirectResolver({
        resolveDns,
        httpHead,
        httpGet,
      });

      const identity = await resolver.resolveTyGlToIdentity(
        'https://ty.gl/abc',
      );
      expect(identity.sourceProductId).toBe('1234567');
      expect(httpHead).toHaveBeenCalledTimes(1);
      expect(httpHead).toHaveBeenCalledWith(
        'https://ty.gl/abc',
        expect.anything(),
      );
      expect(httpGet).not.toHaveBeenCalled();
      expect(resolveDns).toHaveBeenCalledWith('ty.gl', expect.anything());
      expect(resolveDns).toHaveBeenCalledWith(
        'www.trendyol.com',
        expect.anything(),
      );
    });
  });
});

describe('destroyResponseStream', () => {
  it('destroys readable streams', async () => {
    const stream = new Readable({ read() {} });
    const destroySpy = jest.spyOn(stream, 'destroy');
    await destroyResponseStream(stream);
    expect(destroySpy).toHaveBeenCalled();
  });
});
