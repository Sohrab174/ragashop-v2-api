import {
  incompleteSlideDestinationMessages,
  isIncompleteStorefrontHref,
  isWithinSchedule,
  mergeHomeConfigForPersistence,
  normalizeCampaignSlides,
  normalizeCategoryChaptersConfig,
  normalizeCategoryChaptersList,
  normalizeFeaturedBrandsConfig,
  optionalStorefrontHref,
  parseProductIdList,
  resolveCampaignHref,
  sanitizeHomeImageProfile,
  sanitizeHomeMasterConfigPath,
  sanitizeHomeUploadPath,
  sanitizePreviousImageSnapshot,
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

  it('accepts only /home-masters retained paths', () => {
    expect(sanitizeHomeMasterConfigPath('/home-masters/a.jpg')).toBe(
      '/home-masters/a.jpg',
    );
    expect(sanitizeHomeMasterConfigPath('/home/a.jpg')).toBeUndefined();
    expect(sanitizeHomeMasterConfigPath('/home-masters/../x')).toBeUndefined();
  });

  it('preserves complete previousImage metadata and rejects unsafe paths', () => {
    const snap = sanitizePreviousImageSnapshot({
      desktopImagePath: '/home/d.webp',
      mobileImagePath: '/home/m.webp',
      mobileWideImagePath: '/home/w.webp',
      masterImagePath: '/home-masters/src.jpg',
      masterPreviewPath: '/home/p.webp',
      imageProfile: 'category',
      objectPositionDesktop: '12% 34%',
      objectPositionMobile: '56% 78%',
      evil: '/etc/passwd',
      imagePath: '/products/nope.jpg',
    });
    expect(snap).toEqual({
      desktopImagePath: '/home/d.webp',
      mobileImagePath: '/home/m.webp',
      mobileWideImagePath: '/home/w.webp',
      masterImagePath: '/home-masters/src.jpg',
      masterPreviewPath: '/home/p.webp',
      imageProfile: 'category',
      objectPositionDesktop: '12% 34%',
      objectPositionMobile: '56% 78%',
      imagePath: undefined,
    });
    expect(
      sanitizePreviousImageSnapshot({
        desktopImagePath: '/home/../secret.webp',
        masterImagePath: '/home/not-master.webp',
      }),
    ).toBeUndefined();
  });

  it('keeps legacy previousImage snapshots with fewer fields', () => {
    expect(
      sanitizePreviousImageSnapshot({
        desktopImagePath: '/home/old.webp',
        objectPositionDesktop: '10% 20%',
      }),
    ).toEqual({
      desktopImagePath: '/home/old.webp',
      mobileImagePath: undefined,
      mobileWideImagePath: undefined,
      imagePath: undefined,
      masterImagePath: undefined,
      masterPreviewPath: undefined,
      imageProfile: undefined,
      objectPositionDesktop: '10% 20%',
      objectPositionMobile: undefined,
    });
  });

  it('coerces invalid hero chapter profiles to category', () => {
    expect(sanitizeHomeImageProfile('hero', { allowHero: false })).toBe(
      'category',
    );
    expect(sanitizeHomeImageProfile('hero', { allowHero: true })).toBe('hero');
    expect(sanitizeHomeImageProfile('pets', { allowHero: false })).toBe('pets');
    const cfg = normalizeCategoryChaptersConfig({
      chapters: [
        {
          categoryId: 14,
          imageProfile: 'hero',
          masterImagePath: '/home-masters/m.jpg',
          previousImage: {
            desktopImagePath: '/home/old.webp',
            masterImagePath: '/home-masters/old.jpg',
            imageProfile: 'hero',
          },
        },
      ],
    });
    expect(cfg.chapters?.[0]?.imageProfile).toBe('category');
    expect(cfg.chapters?.[0]?.previousImage?.imageProfile).toBe('category');
    expect(cfg.chapters?.[0]?.masterImagePath).toBe('/home-masters/m.jpg');
    expect(cfg.chapters?.[0]?.previousImage?.masterImagePath).toBe(
      '/home-masters/old.jpg',
    );
  });

  it('round-trips chapter image-manager fields through normalize + merge', () => {
    const normalized = normalizeCategoryChaptersConfig({
      chapters: [
        {
          categoryId: 99,
          desktopImagePath: '/home/new-d.webp',
          mobileImagePath: '/home/new-m.webp',
          mobileWideImagePath: '/home/new-w.webp',
          masterImagePath: '/home-masters/new.jpg',
          masterPreviewPath: '/home/new-p.webp',
          imageProfile: 'pets',
          objectPositionDesktop: '11% 22%',
          objectPositionMobile: '33% 44%',
          previousImage: {
            desktopImagePath: '/home/old-d.webp',
            mobileImagePath: '/home/old-m.webp',
            mobileWideImagePath: '/home/old-w.webp',
            masterImagePath: '/home-masters/old.jpg',
            masterPreviewPath: '/home/old-p.webp',
            imageProfile: 'category',
            objectPositionDesktop: '1% 2%',
            objectPositionMobile: '3% 4%',
          },
        },
      ],
    });
    const merged = mergeHomeConfigForPersistence(
      'category_chapters',
      normalized as Record<string, unknown>,
      {},
    );
    expect(merged.chapters).toEqual([
      expect.objectContaining({
        categoryId: 99,
        desktopImagePath: '/home/new-d.webp',
        mobileWideImagePath: '/home/new-w.webp',
        masterImagePath: '/home-masters/new.jpg',
        imageProfile: 'pets',
        previousImage: expect.objectContaining({
          masterImagePath: '/home-masters/old.jpg',
          mobileWideImagePath: '/home/old-w.webp',
          imageProfile: 'category',
          objectPositionMobile: '3% 4%',
        }),
      }),
    ]);
  });

  it('preserves hero profile on campaign slides', () => {
    const slides = normalizeCampaignSlides({
      slides: [
        {
          id: 's1',
          title: 'هیرو',
          desktopImagePath: '/home/h.webp',
          imageProfile: 'hero',
          masterImagePath: '/home-masters/h.jpg',
          previousImage: {
            desktopImagePath: '/home/prev.webp',
            masterImagePath: '/home-masters/prev.jpg',
            imageProfile: 'hero',
          },
        },
      ],
    });
    expect(slides?.[0]?.imageProfile).toBe('hero');
    expect(slides?.[0]?.previousImage?.imageProfile).toBe('hero');
    expect(slides?.[0]?.masterImagePath).toBe('/home-masters/h.jpg');
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

  it('rejects incomplete slide paths and keeps valid saved destinations', () => {
    expect(isIncompleteStorefrontHref('/category/')).toBe(true);
    expect(isIncompleteStorefrontHref('category/')).toBe(true);
    expect(isIncompleteStorefrontHref('/product/')).toBe(true);
    expect(isIncompleteStorefrontHref('/category')).toBe(false);
    expect(isIncompleteStorefrontHref('/category/12')).toBe(false);
    expect(isIncompleteStorefrontHref('/product/9')).toBe(false);
    expect(isIncompleteStorefrontHref('/sale')).toBe(false);
    expect(
      incompleteSlideDestinationMessages({
        ctaDestinationType: 'absolute_path',
        ctaDestinationValue: '/category/12',
        slides: [
          { ctaDestinationType: 'absolute_path', ctaDestinationValue: '/category/' },
          { ctaDestinationType: 'category', ctaDestinationValue: 4 },
        ],
      }),
    ).toEqual([
      'اسلاید 1: مسیر مقصد ناقص است. مسیرهایی مثل /category/ پذیرفته نمی‌شوند.',
    ]);
    expect(
      resolveCampaignHref({
        ctaDestinationType: 'absolute_path',
        ctaDestinationValue: '/category/12',
      }),
    ).toBe('/category/12');
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

  it('preserves chapter objectPositionDesktop and objectPositionMobile', () => {
    const cfg = normalizeCategoryChaptersConfig({
      chapters: [
        {
          categoryId: 14,
          desktopImagePath: '/home/desk.webp',
          mobileImagePath: '/home/mob.webp',
          objectPositionDesktop: '42% 18%',
          objectPositionMobile: '55% 30%',
          hack: 'drop-me',
        },
      ],
    });
    expect(cfg.chapters?.[0]).toEqual(
      expect.objectContaining({
        categoryId: 14,
        desktopImagePath: '/home/desk.webp',
        mobileImagePath: '/home/mob.webp',
        objectPositionDesktop: '42% 18%',
        objectPositionMobile: '55% 30%',
      }),
    );
    expect((cfg.chapters?.[0] as Record<string, unknown>).hack).toBeUndefined();

    const merged = mergeHomeConfigForPersistence(
      'category_chapters',
      normalizeCategoryChaptersConfig({
        chapters: [
          {
            categoryId: 14,
            desktopImagePath: '/home/desk.webp',
            objectPositionDesktop: '10% 20%',
            objectPositionMobile: '30% 40%',
          },
        ],
      }) as Record<string, unknown>,
      {
        chapters: [
          {
            categoryId: 14,
            desktopImagePath: '/home/old.webp',
            objectPositionDesktop: '1% 2%',
            legacyNote: 'keep',
          },
        ],
      },
    );
    expect(merged.chapters).toEqual([
      expect.objectContaining({
        categoryId: 14,
        desktopImagePath: '/home/desk.webp',
        objectPositionDesktop: '10% 20%',
        objectPositionMobile: '30% 40%',
        legacyNote: 'keep',
      }),
    ]);
  });

  it('treats legacy {} chapter config as unmanaged and keeps explicit empty chapters', () => {
    expect(normalizeCategoryChaptersList({})).toBeUndefined();
    expect(normalizeCategoryChaptersConfig({})).toEqual({});
    expect(normalizeCategoryChaptersList({ chapters: [] })).toEqual([]);
    expect(normalizeCategoryChaptersConfig({ chapters: [] })).toEqual({
      chapters: [],
    });
    expect(
      mergeHomeConfigForPersistence('category_chapters', {}, { chapters: [] }),
    ).toEqual({ chapters: [] });
    expect(
      mergeHomeConfigForPersistence(
        'category_chapters',
        { chapters: [] },
        { chapters: [{ categoryId: 1 }] },
      ),
    ).toEqual({ chapters: [] });
  });

  it('keeps featured brands automatic unless an intentional empty list is sent', () => {
    expect(normalizeFeaturedBrandsConfig({})).toEqual({});
    expect(normalizeFeaturedBrandsConfig({ brands: [] })).toEqual({
      brands: [],
    });
    expect(
      normalizeFeaturedBrandsConfig({
        brands: [{ enabled: true, order: 1 }],
      }),
    ).toEqual({});
    expect(
      normalizeFeaturedBrandsConfig({
        brands: [
          { brandId: 9, enabled: true, order: 1, logoPath: '/home/a.webp' },
        ],
      }),
    ).toEqual({
      brands: [
        { brandId: 9, order: 1, enabled: true, logoPath: '/home/a.webp' },
      ],
    });
  });

  it('keeps legacy {} chapters unmanaged and preserves an explicit empty list', () => {
    expect(normalizeCategoryChaptersList({})).toBeUndefined();
    expect(normalizeCategoryChaptersConfig({}).chapters).toBeUndefined();
    expect(normalizeCategoryChaptersList({ chapters: [] })).toEqual([]);
    expect(normalizeCategoryChaptersConfig({ chapters: [] }).chapters).toEqual([]);

    const keptDefault = mergeHomeConfigForPersistence(
      'category_chapters',
      normalizeCategoryChaptersConfig({}) as Record<string, unknown>,
      {},
    );
    expect(keptDefault.chapters).toBeUndefined();

    const keptEmpty = mergeHomeConfigForPersistence(
      'category_chapters',
      normalizeCategoryChaptersConfig({ chapters: [] }) as Record<string, unknown>,
      {},
    );
    expect(keptEmpty.chapters).toEqual([]);

    const preservedPrior = mergeHomeConfigForPersistence(
      'category_chapters',
      normalizeCategoryChaptersConfig({ limit: 4 }) as Record<string, unknown>,
      { chapters: [] },
    );
    expect(preservedPrior.chapters).toEqual([]);
  });

  it('keeps previous slides when the key is omitted and stores an empty list when sent', () => {
    expect(normalizeCampaignSlides({ ctaLabel: 'x' })).toBeUndefined();
    expect(normalizeCampaignSlides({ slides: [] })).toEqual([]);
    const draft = normalizeCampaignSlides({
      slides: [
        {
          id: 'draft',
          title: 'پیش‌نویس',
          ctaDestinationType: 'absolute_path',
          ctaDestinationValue: 'https://evil.test',
          desktopImagePath: 'https://cdn.example/a.jpg',
        },
      ],
    });
    expect(draft).toEqual([
      expect.objectContaining({
        id: 'draft',
        title: 'پیش‌نویس',
        enabled: true,
      }),
    ]);
    expect(draft?.[0].desktopImagePath).toBeUndefined();
    expect(resolveCampaignHref(draft![0])).toBe('/');
    const kept = mergeHomeConfigForPersistence(
      'campaign',
      { ctaLabel: 'جدید', desktopImagePath: '/home/legacy.webp' },
      {
        ctaLabel: 'قدیم',
        desktopImagePath: '/home/legacy.webp',
        slides: [{ id: 's1', enabled: false, order: 10, title: 'قدیم' }],
      },
    );
    expect(kept.ctaLabel).toBe('جدید');
    expect(kept.desktopImagePath).toBe('/home/legacy.webp');
    expect(kept.slides).toEqual([
      { id: 's1', enabled: false, order: 10, title: 'قدیم' },
    ]);
    const cleared = mergeHomeConfigForPersistence(
      'campaign',
      { ctaLabel: 'جدید', slides: [] },
      { ctaLabel: 'قدیم', slides: [{ id: 's1', title: 'قدیم' }] },
    );
    expect(cleared.slides).toEqual([]);
    expect(cleared.ctaLabel).toBe('جدید');
  });

  it('merges preserved unknown keys without accepting client unknowns', () => {
    const merged = mergeHomeConfigForPersistence(
      'campaign',
      { ctaLabel: 'جدید', preferredProductId: 5 },
      { ctaLabel: 'قدیم', preferredProductId: 5, mystery: true, clientHack: 'old' },
    );
    expect(merged).toEqual({
      ctaLabel: 'جدید',
      preferredProductId: 5,
      mystery: true,
      clientHack: 'old',
    });
  });

  it('preserves nested unknown presentation fields by categoryId identity', () => {
    const merged = mergeHomeConfigForPersistence(
      'categories',
      {
        limit: 6,
        categoryIds: [14],
        presentation: [{ categoryId: 14, imagePath: '/home/a.webp' }],
      },
      {
        limit: 4,
        categoryIds: [14],
        presentation: [
          {
            categoryId: 14,
            imagePath: '/home/old.webp',
            legacyBadge: 'keep-me',
          },
        ],
        clientInvented: 'nope',
      },
    );
    expect(merged.clientInvented).toBe('nope');
    expect(merged.presentation).toEqual([
      {
        categoryId: 14,
        imagePath: '/home/a.webp',
        legacyBadge: 'keep-me',
      },
    ]);
    expect(
      mergeHomeConfigForPersistence(
        'categories',
        {
          presentation: [
            { categoryId: 14, imagePath: '/home/a.webp', hack: 'from-client' },
          ],
        },
        { presentation: [{ categoryId: 14, legacyBadge: 'keep-me' }] },
      ).presentation,
    ).toEqual([
      {
        categoryId: 14,
        imagePath: '/home/a.webp',
        legacyBadge: 'keep-me',
      },
    ]);
  });
});
