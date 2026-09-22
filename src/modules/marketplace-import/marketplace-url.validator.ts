export const MAX_MARKETPLACE_URL_LENGTH = 2048;

export const TRENDYOL_HOSTS = new Set(['trendyol.com', 'www.trendyol.com']);
export const TY_GL_HOSTS = new Set(['ty.gl']);

export type MarketplaceImportErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_MARKETPLACE'
  | 'UNSUPPORTED_PRODUCT_URL'
  | 'URL_TOO_LONG'
  | 'UNSUPPORTED_PROTOCOL'
  | 'CREDENTIALS_IN_URL'
  | 'UNEXPECTED_PORT'
  | 'PRIVATE_DESTINATION'
  | 'FRAGMENT_NOT_ALLOWED';

export class MarketplaceUrlValidationError extends Error {
  constructor(
    public readonly code: MarketplaceImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MarketplaceUrlValidationError';
  }
}

export interface CanonicalMarketplaceIdentity {
  marketplace: 'trendyol';
  sourceProductId: string;
  canonicalUrl: string;
  sourceUrl: string;
}

function isPrivateOrLocalIpv4(host: string): boolean {
  const parts = host.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) {
    return false;
  }
  const [a, b] = parts;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateOrLocalIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80')) return true;
  return false;
}

export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (isPrivateOrLocalIpv4(host) || isPrivateOrLocalIpv6(host)) return true;
  return false;
}

export function isAllowedMarketplaceHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (isBlockedHost(host)) return false;
  return TRENDYOL_HOSTS.has(host) || TY_GL_HOSTS.has(host);
}

export function isTyGlHost(hostname: string): boolean {
  return TY_GL_HOSTS.has(hostname.toLowerCase().replace(/\.$/, ''));
}

export function isTrendyolHost(hostname: string): boolean {
  return TRENDYOL_HOSTS.has(hostname.toLowerCase().replace(/\.$/, ''));
}

export function parseUrlStrict(rawUrl: string): URL {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    throw new MarketplaceUrlValidationError(
      'INVALID_URL',
      'لینک وارد شده معتبر نیست.',
    );
  }
  if (trimmed.length > MAX_MARKETPLACE_URL_LENGTH) {
    throw new MarketplaceUrlValidationError(
      'URL_TOO_LONG',
      'لینک وارد شده بیش از حد طولانی است.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new MarketplaceUrlValidationError(
      'INVALID_URL',
      'لینک وارد شده معتبر نیست.',
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new MarketplaceUrlValidationError(
      'UNSUPPORTED_PROTOCOL',
      'فقط لینک‌های امن (HTTPS) پشتیبانی می‌شوند.',
    );
  }

  if (parsed.username || parsed.password) {
    throw new MarketplaceUrlValidationError(
      'CREDENTIALS_IN_URL',
      'لینک وارد شده معتبر نیست.',
    );
  }

  if (parsed.port && parsed.port !== '443') {
    throw new MarketplaceUrlValidationError(
      'UNEXPECTED_PORT',
      'لینک وارد شده معتبر نیست.',
    );
  }

  if (parsed.hash) {
    throw new MarketplaceUrlValidationError(
      'FRAGMENT_NOT_ALLOWED',
      'لینک وارد شده معتبر نیست.',
    );
  }

  const host = parsed.hostname.toLowerCase();
  if (isBlockedHost(host)) {
    throw new MarketplaceUrlValidationError(
      'PRIVATE_DESTINATION',
      'لینک وارد شده معتبر نیست.',
    );
  }

  if (!isAllowedMarketplaceHost(host)) {
    throw new MarketplaceUrlValidationError(
      'UNSUPPORTED_MARKETPLACE',
      'این فروشگاه در حال حاضر پشتیبانی نمی‌شود.',
    );
  }

  return parsed;
}

/** Known first-segment locale prefixes (not brand slugs). */
const TRENDYOL_LOCALE_PREFIXES = new Set([
  'en',
  'de',
  'ar',
  'fr',
  'ru',
  'nl',
  'pl',
  'ro',
  'hu',
  'cs',
  'sk',
  'bg',
  'el',
  'uk',
]);

export function extractTrendyolProductId(pathname: string): string | null {
  const match = pathname.match(/-p-(\d+)(?:\/|$)/i);
  if (!match) {
    return null;
  }
  const id = match[1];
  if (!id || /^0+$/.test(id) || id.length > 12) {
    return null;
  }
  return id;
}

/**
 * Stable path driven by product ID so locale/slug variants converge.
 * Fetched via existing crawler page navigation (Trendyol redirects to the live slug).
 */
export function buildIdCentricTrendyolPath(productId: string): string {
  return `/p/product-p-${productId}`;
}

export function normalizeTrendyolPath(pathname: string): string {
  let path = pathname || '/';
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  path = path.split('?')[0].split('#')[0];

  const segments = path.split('/').filter(Boolean);
  if (
    segments.length > 0 &&
    TRENDYOL_LOCALE_PREFIXES.has(segments[0].toLowerCase())
  ) {
    segments.shift();
    path = segments.length ? `/${segments.join('/')}` : '/';
  }

  return path.startsWith('/') ? path : `/${path}`;
}

export function buildCanonicalTrendyolUrl(pathname: string): string {
  const id = extractTrendyolProductId(pathname);
  if (id) {
    return `https://www.trendyol.com${buildIdCentricTrendyolPath(id)}`;
  }
  const path = normalizeTrendyolPath(pathname);
  return `https://www.trendyol.com${path}`;
}

/** Derive crawler sourceUrl path from a stored canonical URL or path. */
export function sourcePathFromCanonicalUrl(canonicalOrPath: string): string {
  const raw = (canonicalOrPath || '').trim();
  if (!raw) {
    throw new MarketplaceUrlValidationError(
      'INVALID_URL',
      'لینک وارد شده معتبر نیست.',
    );
  }

  let pathname = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      throw new MarketplaceUrlValidationError(
        'INVALID_URL',
        'لینک وارد شده معتبر نیست.',
      );
    }
  }

  const id = extractTrendyolProductId(pathname);
  if (id) {
    return buildIdCentricTrendyolPath(id);
  }
  return normalizeTrendyolPath(pathname);
}

export function identityFromTrendyolUrl(
  parsed: URL,
): CanonicalMarketplaceIdentity {
  const sourceProductId = extractTrendyolProductId(parsed.pathname);
  if (!sourceProductId) {
    throw new MarketplaceUrlValidationError(
      'UNSUPPORTED_PRODUCT_URL',
      'لینک محصول معتبر نیست. لطفاً لینک مستقیم محصول از ترندیول را وارد کنید.',
    );
  }

  const sourceUrl = buildIdCentricTrendyolPath(sourceProductId);
  const canonicalUrl = `https://www.trendyol.com${sourceUrl}`;

  return {
    marketplace: 'trendyol',
    sourceProductId,
    canonicalUrl,
    sourceUrl,
  };
}

export function validateInitialMarketplaceUrl(
  rawUrl: string,
):
  | { needsRedirect: true; url: string }
  | { needsRedirect: false; identity: CanonicalMarketplaceIdentity } {
  const parsed = parseUrlStrict(rawUrl);
  const host = parsed.hostname.toLowerCase();

  if (isTyGlHost(host)) {
    return { needsRedirect: true as const, url: parsed.toString() };
  }

  if (isTrendyolHost(host)) {
    return {
      needsRedirect: false as const,
      identity: identityFromTrendyolUrl(parsed),
    };
  }

  throw new MarketplaceUrlValidationError(
    'UNSUPPORTED_MARKETPLACE',
    'این فروشگاه در حال حاضر پشتیبانی نمی‌شود.',
  );
}

export function validateResolvedTrendyolUrl(
  rawUrl: string,
): CanonicalMarketplaceIdentity {
  const parsed = parseUrlStrict(rawUrl);
  const host = parsed.hostname.toLowerCase();

  if (!isTrendyolHost(host)) {
    throw new MarketplaceUrlValidationError(
      'UNSUPPORTED_MARKETPLACE',
      'لینک کوتاه به مقصد معتبر ترندیول منتهی نشد.',
    );
  }

  return identityFromTrendyolUrl(parsed);
}
