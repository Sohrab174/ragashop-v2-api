import {
  buildCanonicalTrendyolUrl,
  extractTrendyolProductId,
  identityFromTrendyolUrl,
  isAllowedMarketplaceHost,
  isBlockedHost,
  normalizeTrendyolPath,
  parseUrlStrict,
  sourcePathFromCanonicalUrl,
  validateInitialMarketplaceUrl,
  validateResolvedTrendyolUrl,
  MarketplaceUrlValidationError,
} from './marketplace-url.validator';

describe('MarketplaceUrlValidator', () => {
  const validProductPath = '/brand/product-name-p-1234567';

  describe('valid URLs', () => {
    it.each([
      `https://www.trendyol.com${validProductPath}`,
      `https://trendyol.com${validProductPath}`,
      'https://ty.gl/abc123',
    ])('accepts %s', (url) => {
      expect(() => parseUrlStrict(url)).not.toThrow();
    });

    it('strips query params and affiliate tags from identity', () => {
      const withQuery = identityFromTrendyolUrl(
        parseUrlStrict(
          `https://www.trendyol.com${validProductPath}?utm_source=aff&utm_medium=cpc&gclid=abc`,
        ),
      );
      const clean = identityFromTrendyolUrl(
        parseUrlStrict(`https://www.trendyol.com${validProductPath}`),
      );
      expect(withQuery.sourceProductId).toBe(clean.sourceProductId);
      expect(withQuery.canonicalUrl).toBe(clean.canonicalUrl);
      expect(withQuery.sourceUrl).toBe(clean.sourceUrl);
    });

    it('normalizes www vs apex and /en/ prefix to the same identity', () => {
      const www = identityFromTrendyolUrl(
        parseUrlStrict(`https://www.trendyol.com${validProductPath}`),
      );
      const apex = identityFromTrendyolUrl(
        parseUrlStrict(`https://trendyol.com${validProductPath}`),
      );
      const english = identityFromTrendyolUrl(
        parseUrlStrict(`https://www.trendyol.com/en${validProductPath}`),
      );
      expect(www.sourceProductId).toBe('1234567');
      expect(apex.sourceProductId).toBe(www.sourceProductId);
      expect(english.sourceProductId).toBe(www.sourceProductId);
      expect(www.canonicalUrl).toBe(
        'https://www.trendyol.com/p/product-p-1234567',
      );
      expect(english.canonicalUrl).toBe(www.canonicalUrl);
      expect(english.sourceUrl).toBe('/p/product-p-1234567');
      expect(www.sourceUrl).toBe(english.sourceUrl);
    });

    it('converges different slugs and tracking params to the same sourceId identity', () => {
      const turkish = identityFromTrendyolUrl(
        parseUrlStrict(
          'https://www.trendyol.com/brand/turkce-slug-p-999001',
        ),
      );
      const englishSlug = identityFromTrendyolUrl(
        parseUrlStrict(
          'https://www.trendyol.com/en/brand/english-slug-p-999001?utm_source=x',
        ),
      );
      const otherSlug = identityFromTrendyolUrl(
        parseUrlStrict(
          'https://trendyol.com/other-brand/changed-slug-p-999001',
        ),
      );
      expect(turkish.sourceProductId).toBe('999001');
      expect(englishSlug.sourceProductId).toBe(turkish.sourceProductId);
      expect(otherSlug.sourceProductId).toBe(turkish.sourceProductId);
      expect(turkish.canonicalUrl).toBe(englishSlug.canonicalUrl);
      expect(otherSlug.sourceUrl).toBe('/p/product-p-999001');
    });

    it('derives crawler path from stored full canonical URL', () => {
      expect(
        sourcePathFromCanonicalUrl(
          'https://www.trendyol.com/brand/x-p-555',
        ),
      ).toBe('/p/product-p-555');
      expect(sourcePathFromCanonicalUrl('/en/brand/y-p-555')).toBe(
        '/p/product-p-555',
      );
    });

    it('rejects mobile host m.trendyol.com (not in allowlist)', () => {
      expect(() =>
        parseUrlStrict(`https://m.trendyol.com${validProductPath}`),
      ).toThrow(MarketplaceUrlValidationError);
    });

    it('treats ty.gl as needing redirect', () => {
      const result = validateInitialMarketplaceUrl('https://ty.gl/abc');
      expect(result.needsRedirect).toBe(true);
    });
  });

  describe('invalid URLs', () => {
    it.each([
      ['http://trendyol.com/p-p-1', 'UNSUPPORTED_PROTOCOL'],
      ['https://trendyol.com.attacker.com/p-p-1', 'UNSUPPORTED_MARKETPLACE'],
      ['https://eviltrendyol.com/p-p-1', 'UNSUPPORTED_MARKETPLACE'],
      ['https://ty.gl.attacker.com/x', 'UNSUPPORTED_MARKETPLACE'],
      ['https://localhost/p-p-1', 'PRIVATE_DESTINATION'],
      ['https://127.0.0.1/p-p-1', 'PRIVATE_DESTINATION'],
      ['https://[::1]/p-p-1', 'UNSUPPORTED_MARKETPLACE'],
      ['https://192.168.1.1/p-p-1', 'PRIVATE_DESTINATION'],
      ['https://10.0.0.1/p-p-1', 'PRIVATE_DESTINATION'],
      ['https://169.254.1.1/p-p-1', 'PRIVATE_DESTINATION'],
      ['https://user:pass@www.trendyol.com/p-p-1', 'CREDENTIALS_IN_URL'],
      ['https://www.trendyol.com:8080/p-p-1', 'UNEXPECTED_PORT'],
      ['not-a-url', 'INVALID_URL'],
      ['https://www.amazon.com/p-p-1', 'UNSUPPORTED_MARKETPLACE'],
      ['https://www.beymen.com/p-1', 'UNSUPPORTED_MARKETPLACE'],
    ])('rejects %s with %s', (url, code) => {
      try {
        parseUrlStrict(url);
        if (code === 'UNSUPPORTED_PRODUCT_URL') return;
        fail(`Expected rejection for ${url}`);
      } catch (error) {
        expect(error).toBeInstanceOf(MarketplaceUrlValidationError);
        expect((error as MarketplaceUrlValidationError).code).toBe(code);
      }
    });

    it('rejects non-product trendyol URL', () => {
      expect(() =>
        identityFromTrendyolUrl(
          parseUrlStrict('https://www.trendyol.com/kategori'),
        ),
      ).toThrow(MarketplaceUrlValidationError);
    });

    it('rejects excessive URL length', () => {
      const long = `https://www.trendyol.com/${'a'.repeat(3000)}-p-1`;
      expect(() => parseUrlStrict(long)).toThrow(MarketplaceUrlValidationError);
    });

    it('rejects URL fragments', () => {
      expect(() =>
        parseUrlStrict(`https://www.trendyol.com${validProductPath}#frag`),
      ).toThrow(MarketplaceUrlValidationError);
    });
  });

  describe('host helpers', () => {
    it('blocks deceptive and private hosts', () => {
      expect(isBlockedHost('127.0.0.1')).toBe(true);
      expect(isBlockedHost('trendyol.com.attacker.com')).toBe(false);
      expect(isAllowedMarketplaceHost('trendyol.com.attacker.com')).toBe(false);
    });

    it('extracts product id', () => {
      expect(extractTrendyolProductId('/x-p-99')).toBe('99');
      expect(extractTrendyolProductId('/category')).toBeNull();
    });
  });

  describe('validateResolvedTrendyolUrl', () => {
    it('accepts resolved trendyol destination', () => {
      const identity = validateResolvedTrendyolUrl(
        `https://trendyol.com${validProductPath}`,
      );
      expect(identity.sourceProductId).toBe('1234567');
    });

    it('rejects resolved external destination', () => {
      expect(() =>
        validateResolvedTrendyolUrl('https://evil.com/p-p-1'),
      ).toThrow(MarketplaceUrlValidationError);
    });
  });
});
