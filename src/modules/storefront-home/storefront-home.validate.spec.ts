import {
  isWithinSchedule,
  normalizeCategoryChaptersConfig,
  optionalStorefrontHref,
  parseProductIdList,
  resolveCampaignHref,
  sanitizeHomeUploadPath,
  sanitizeStorefrontHref,
} from './storefront-home.validate';

describe('storefront-home.validate', () => {
  it('sanitizes storefront hrefs to relative paths only', () => {
    expect(sanitizeStorefrontHref('/category/1')).toBe('/category/1');
    expect(sanitizeStorefrontHref('https://evil.test')).toBe('/');
    expect(sanitizeStorefrontHref('javascript:alert(1)')).toBe('/');
    expect(sanitizeStorefrontHref('//cdn.example/x')).toBe('/');
    expect(optionalStorefrontHref(null)).toBeUndefined();
    expect(optionalStorefrontHref('/search?q=a')).toBe('/search?q=a');
  });

  it('accepts only /home upload paths', () => {
    expect(sanitizeHomeUploadPath('/home/abc.webp')).toBe('/home/abc.webp');
    expect(sanitizeHomeUploadPath('/products/x.jpg')).toBeUndefined();
    expect(sanitizeHomeUploadPath('/home/../secret')).toBeUndefined();
  });

  it('parses product id lists and drops junk', () => {
    expect(parseProductIdList([1, '2', 0, -3, 2, 'x', 1.7])).toEqual([
      1, 2,
    ]);
  });

  it('respects schedule windows', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    expect(
      isWithinSchedule(
        new Date('2026-06-01T00:00:00Z'),
        new Date('2026-06-30T00:00:00Z'),
        now,
      ),
    ).toBe(true);
    expect(
      isWithinSchedule(new Date('2026-07-01T00:00:00Z'), null, now),
    ).toBe(false);
  });

  it('resolves campaign destinations safely', () => {
    expect(
      resolveCampaignHref({
        ctaDestinationType: 'product',
        preferredProductId: 99,
      }),
    ).toBe('/product/99');
    expect(
      resolveCampaignHref({
        ctaDestinationType: 'absolute_path',
        ctaDestinationValue: 'https://evil.test',
      }),
    ).toBe('/');
    expect(
      resolveCampaignHref({
        ctaDestinationType: 'search_query',
        ctaDestinationValue: 'کفش',
      }),
    ).toContain('/search?q=');
  });

  it('normalizes category chapter configs without inventing ids', () => {
    const cfg = normalizeCategoryChaptersConfig({
      limit: 4,
      chapters: [
        {
          categoryId: 14,
          title: 'زنانه',
          surfaceTone: 'blush',
          productIds: [1, 0, '2'],
          enabled: true,
        },
        { categoryId: 'x' },
        { surfaceTone: 'rainbow' },
      ],
    });
    expect(cfg.limit).toBe(4);
    expect(cfg.chapters).toHaveLength(1);
    expect(cfg.chapters?.[0]?.categoryId).toBe(14);
    expect(cfg.chapters?.[0]?.surfaceTone).toBe('blush');
    expect(cfg.chapters?.[0]?.productIds).toEqual([1, 2]);
  });
});
