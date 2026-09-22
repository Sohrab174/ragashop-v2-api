import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import axios, { AxiosResponse } from 'axios';
import * as dns from 'dns/promises';
import { Readable } from 'stream';
import {
  CanonicalMarketplaceIdentity,
  isBlockedHost,
  MarketplaceUrlValidationError,
  parseUrlStrict,
  validateResolvedTrendyolUrl,
} from './marketplace-url.validator';
import {
  MarketplaceConfigError,
  parsePositiveIntConfig,
} from './marketplace-config.util';

export class MarketplaceRedirectError extends Error {
  constructor(
    public readonly code:
      | 'REDIRECT_CHAIN_TOO_LONG'
      | 'REDIRECT_TIMEOUT'
      | 'REDIRECT_FAILED'
      | 'PRIVATE_DESTINATION'
      | 'UNSUPPORTED_MARKETPLACE'
      | 'RESPONSE_TOO_LARGE',
    message: string,
  ) {
    super(message);
    this.name = 'MarketplaceRedirectError';
  }
}

export interface RedirectResolverOptions {
  maxRedirects?: number;
  hopTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxResponseBytes?: number;
  resolveDns?: typeof dns.lookup;
  httpHead?: typeof axios.head;
  httpGet?: typeof axios.get;
  now?: () => number;
}

const DEFAULT_MAX_RESPONSE_BYTES = 8192;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HEAD_NOT_SUPPORTED_STATUSES = new Set([405, 501]);

interface HopResponse {
  status: number;
  headers: Record<string, unknown>;
}

export const MARKETPLACE_REDIRECT_RESOLVER_OPTIONS =
  'MARKETPLACE_REDIRECT_RESOLVER_OPTIONS';

@Injectable()
export class MarketplaceRedirectResolver {
  private readonly logger = new Logger(MarketplaceRedirectResolver.name);

  private readonly maxRedirects: number;
  private readonly hopTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly resolveDns: typeof dns.lookup;
  private readonly httpHead: typeof axios.head;
  private readonly httpGet: typeof axios.get;
  private readonly now: () => number;

  constructor(
    @Optional()
    @Inject(MARKETPLACE_REDIRECT_RESOLVER_OPTIONS)
    options?: RedirectResolverOptions,
  ) {
    const resolved: RedirectResolverOptions = options ?? {};
    try {
      this.maxRedirects =
        resolved.maxRedirects ??
        parsePositiveIntConfig(
          process.env.MARKETPLACE_REDIRECT_MAX_HOPS,
          10,
          1,
          20,
          'MARKETPLACE_REDIRECT_MAX_HOPS',
        );
      this.hopTimeoutMs =
        resolved.hopTimeoutMs ??
        parsePositiveIntConfig(
          process.env.MARKETPLACE_REDIRECT_TIMEOUT_MS,
          10000,
          1000,
          60000,
          'MARKETPLACE_REDIRECT_TIMEOUT_MS',
        );
      this.totalTimeoutMs =
        resolved.totalTimeoutMs ??
        parsePositiveIntConfig(
          process.env.MARKETPLACE_REDIRECT_TOTAL_TIMEOUT_MS,
          15000,
          1000,
          120000,
          'MARKETPLACE_REDIRECT_TOTAL_TIMEOUT_MS',
        );
    } catch (error) {
      if (Object.keys(resolved).length > 0) {
        throw error;
      }
      throw new MarketplaceConfigError(
        `Invalid redirect resolver configuration: ${error.message}`,
      );
    }

    this.maxResponseBytes =
      resolved.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.resolveDns = resolved.resolveDns ?? dns.lookup;
    this.httpHead = resolved.httpHead ?? axios.head;
    this.httpGet = resolved.httpGet ?? axios.get;
    this.now = resolved.now ?? (() => Date.now());
  }

  async resolveTyGlToIdentity(
    shortUrl: string,
    overrides: RedirectResolverOptions = {},
  ): Promise<CanonicalMarketplaceIdentity> {
    const maxRedirects = overrides.maxRedirects ?? this.maxRedirects;
    const hopTimeoutMs = overrides.hopTimeoutMs ?? this.hopTimeoutMs;
    const totalTimeoutMs = overrides.totalTimeoutMs ?? this.totalTimeoutMs;
    const maxResponseBytes =
      overrides.maxResponseBytes ?? this.maxResponseBytes;
    const resolveDns = overrides.resolveDns ?? this.resolveDns;
    const httpHead = overrides.httpHead ?? this.httpHead;
    const httpGet = overrides.httpGet ?? this.httpGet;
    const now = overrides.now ?? this.now;

    const deadline = now() + totalTimeoutMs;
    parseUrlStrict(shortUrl);

    let currentUrl = shortUrl.trim();
    const visited = new Set<string>([currentUrl]);

    for (let hop = 0; hop <= maxRedirects; hop++) {
      this.assertWithinDeadline(deadline, now);

      await this.assertResolvablePublicHost(
        currentUrl,
        resolveDns,
        deadline,
        now,
      );

      const response = await this.fetchRedirectHop(
        currentUrl,
        hopTimeoutMs,
        deadline,
        now,
        maxResponseBytes,
        httpHead,
        httpGet,
      );

      if (response.status >= 300 && response.status < 400) {
        if (!REDIRECT_STATUSES.has(response.status)) {
          throw new MarketplaceRedirectError(
            'REDIRECT_FAILED',
            'لینک کوتاه قابل بررسی نیست.',
          );
        }

        const location = this.readHeader(response.headers, 'location');
        if (!location) {
          throw new MarketplaceRedirectError(
            'REDIRECT_FAILED',
            'لینک کوتاه قابل بررسی نیست.',
          );
        }

        const nextUrl = new URL(location, currentUrl).toString();
        if (!nextUrl.startsWith('https://')) {
          throw new MarketplaceRedirectError(
            'UNSUPPORTED_MARKETPLACE',
            'لینک کوتاه به مقصد امن منتهی نشد.',
          );
        }

        try {
          parseUrlStrict(nextUrl);
        } catch (error) {
          if (error instanceof MarketplaceUrlValidationError) {
            throw new MarketplaceRedirectError(
              'UNSUPPORTED_MARKETPLACE',
              error.message,
            );
          }
          throw error;
        }

        const finalized = await this.finalizeCanonicalDestinationIfValid(
          nextUrl,
          resolveDns,
          deadline,
          now,
        );
        if (finalized) {
          return finalized;
        }

        if (visited.has(nextUrl)) {
          throw new MarketplaceRedirectError(
            'REDIRECT_CHAIN_TOO_LONG',
            'لینک کوتاه بیش از حد طولانی است.',
          );
        }

        visited.add(nextUrl);
        currentUrl = nextUrl;
        continue;
      }

      const finalized = await this.finalizeCanonicalDestinationIfValid(
        currentUrl,
        resolveDns,
        deadline,
        now,
      );
      if (finalized) {
        return finalized;
      }

      throw new MarketplaceRedirectError(
        'UNSUPPORTED_MARKETPLACE',
        'لینک کوتاه به مقصد معتبر منتهی نشد.',
      );
    }

    throw new MarketplaceRedirectError(
      'REDIRECT_CHAIN_TOO_LONG',
      'لینک کوتاه بیش از حد طولانی است.',
    );
  }

  private getRemainingMs(deadline: number, now: () => number): number {
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new MarketplaceRedirectError(
        'REDIRECT_TIMEOUT',
        'زمان بررسی لینک کوتاه به پایان رسید. لطفاً دوباره تلاش کنید.',
      );
    }
    return remaining;
  }

  private resolveHopTimeoutMs(
    hopTimeoutMs: number,
    deadline: number,
    now: () => number,
  ): number {
    return Math.min(hopTimeoutMs, this.getRemainingMs(deadline, now));
  }

  private assertWithinDeadline(deadline: number, now: () => number): void {
    if (now() > deadline) {
      throw new MarketplaceRedirectError(
        'REDIRECT_TIMEOUT',
        'زمان بررسی لینک کوتاه به پایان رسید. لطفاً دوباره تلاش کنید.',
      );
    }
  }

  private async finalizeCanonicalDestinationIfValid(
    url: string,
    resolveDns: typeof dns.lookup,
    deadline: number,
    now: () => number,
  ): Promise<CanonicalMarketplaceIdentity | null> {
    try {
      const identity = validateResolvedTrendyolUrl(url);
      await this.assertResolvablePublicHost(url, resolveDns, deadline, now);
      return identity;
    } catch (error) {
      if (error instanceof MarketplaceUrlValidationError) {
        return null;
      }
      throw error;
    }
  }

  private readHeader(
    headers: Record<string, unknown>,
    name: string,
  ): string | undefined {
    const value = headers[name] ?? headers[name.toLowerCase()];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (
      Array.isArray(value) &&
      typeof value[0] === 'string' &&
      value[0].trim()
    ) {
      return value[0].trim();
    }
    return undefined;
  }

  private async fetchRedirectHop(
    url: string,
    hopTimeoutMs: number,
    deadline: number,
    now: () => number,
    maxResponseBytes: number,
    httpHead: typeof axios.head,
    httpGet: typeof axios.get,
  ): Promise<HopResponse> {
    const headTimeout = this.resolveHopTimeoutMs(hopTimeoutMs, deadline, now);
    const requestConfig = {
      maxRedirects: 0,
      timeout: headTimeout,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'RagaShop-MarketplaceImport/1.0',
      },
    };

    let headResponse: AxiosResponse;
    try {
      headResponse = await httpHead(url, requestConfig);
    } catch (headError) {
      throw this.mapTransportError(headError);
    }

    if (HEAD_NOT_SUPPORTED_STATUSES.has(headResponse.status)) {
      const getTimeout = this.resolveHopTimeoutMs(hopTimeoutMs, deadline, now);
      return this.performGetFallback(
        url,
        {
          maxRedirects: 0,
          timeout: getTimeout,
          validateStatus: () => true,
          headers: requestConfig.headers,
        },
        maxResponseBytes,
        httpGet,
      );
    }

    return {
      status: headResponse.status,
      headers: headResponse.headers as Record<string, unknown>,
    };
  }

  private async performGetFallback(
    url: string,
    requestConfig: {
      maxRedirects: number;
      timeout: number;
      validateStatus: () => boolean;
      headers: Record<string, string>;
    },
    maxResponseBytes: number,
    httpGet: typeof axios.get,
  ): Promise<HopResponse> {
    let response: AxiosResponse | undefined;
    try {
      response = await httpGet(url, {
        ...requestConfig,
        responseType: 'stream',
        maxContentLength: maxResponseBytes,
      });

      return {
        status: response.status,
        headers: response.headers as Record<string, unknown>,
      };
    } catch (getError) {
      if (this.isResponseTooLarge(getError)) {
        throw new MarketplaceRedirectError(
          'RESPONSE_TOO_LARGE',
          'لینک کوتاه قابل بررسی نیست.',
        );
      }
      throw this.mapTransportError(getError);
    } finally {
      if (response?.data) {
        await destroyResponseStream(response.data);
      }
    }
  }

  private mapTransportError(error: unknown): MarketplaceRedirectError {
    const message = String(error);
    if (
      message.includes('timeout') ||
      message.includes('ETIMEDOUT') ||
      message.includes('ECONNABORTED')
    ) {
      return new MarketplaceRedirectError(
        'REDIRECT_TIMEOUT',
        'زمان بررسی لینک کوتاه به پایان رسید. لطفاً دوباره تلاش کنید.',
      );
    }

    this.logger.warn(`Redirect hop transport failure: ${error}`);
    return new MarketplaceRedirectError(
      'REDIRECT_FAILED',
      'لینک کوتاه قابل بررسی نیست. لطفاً لینک مستقیم محصول را وارد کنید.',
    );
  }

  private isResponseTooLarge(error: unknown): boolean {
    return (
      String(error).includes('maxContentLength') ||
      String(error).includes('maxBodyLength')
    );
  }

  private async assertResolvablePublicHost(
    url: string,
    resolveDns: typeof dns.lookup,
    deadline: number,
    now: () => number,
  ): Promise<void> {
    this.assertWithinDeadline(deadline, now);

    const parsed = parseUrlStrict(url);
    const host = parsed.hostname;

    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
      if (isBlockedHost(host)) {
        throw new MarketplaceRedirectError(
          'PRIVATE_DESTINATION',
          'لینک وارد شده معتبر نیست.',
        );
      }
      return;
    }

    const remainingMs = this.getRemainingMs(deadline, now);

    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.lookupHost(host, resolveDns),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new MarketplaceRedirectError(
                'REDIRECT_TIMEOUT',
                'زمان بررسی لینک کوتاه به پایان رسید. لطفاً دوباره تلاش کنید.',
              ),
            );
          }, remainingMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async lookupHost(
    host: string,
    resolveDns: typeof dns.lookup,
  ): Promise<void> {
    let result: unknown;
    try {
      result = await resolveDns(host, { all: true } as any);
    } catch (error) {
      this.logger.warn(`DNS lookup failed for ${host}: ${error}`);
      throw new MarketplaceRedirectError(
        'PRIVATE_DESTINATION',
        'لینک وارد شده معتبر نیست.',
      );
    }

    const addresses = Array.isArray(result) ? result : [result];
    if (addresses.length === 0) {
      throw new MarketplaceRedirectError(
        'PRIVATE_DESTINATION',
        'لینک وارد شده معتبر نیست.',
      );
    }

    for (const entry of addresses) {
      const address = typeof entry === 'string' ? entry : entry.address;
      if (isBlockedHost(address)) {
        throw new MarketplaceRedirectError(
          'PRIVATE_DESTINATION',
          'لینک وارد شده معتبر نیست.',
        );
      }
    }
  }
}

export async function destroyResponseStream(stream: unknown): Promise<void> {
  if (!stream || typeof stream !== 'object') {
    return;
  }

  const readable = stream as Readable & {
    destroy?: (error?: Error) => void;
    close?: () => void;
  };

  if (typeof readable.destroy === 'function') {
    readable.destroy();
    return;
  }

  if (typeof readable.close === 'function') {
    readable.close();
  }
}
