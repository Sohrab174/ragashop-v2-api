import type {
  CampaignSectionConfig,
  CampaignSlideConfig,
  CategoriesSectionConfig,
  CategoryChapterConfig,
  CategoryChaptersSectionConfig,
  EditorialSectionConfig,
  HomeCtaDestinationType,
  HomeRailSource,
  HomeSurfaceTone,
  RailSectionConfig,
  StorefrontHomeSectionKey,
} from './storefront-home.types';
import {
  HOME_SURFACE_TONES,
  isStorefrontHomeSectionKey,
} from './storefront-home.types';

const CTA_TYPES: readonly HomeCtaDestinationType[] = [
  'product',
  'category',
  'search_query',
  'brand_search',
  'newest_rail_category',
  'discount_rail_category',
  'absolute_path',
];

const RAIL_SOURCES: readonly HomeRailSource[] = [
  'newest',
  'discount',
  'curated',
];

/**
 * Incomplete internal paths such as `/category/` or `category/`.
 * Complete paths (`/category`, `/category/12`, `/product/9`, `/sale`) stay valid.
 */
export function isIncompleteStorefrontHref(raw: unknown): boolean {
  if (typeof raw !== 'string') return true;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return true;
  if (trimmed.startsWith('//')) return true;
  if (/[\s\\]/.test(trimmed)) return true;
  if (/^[a-z]+:/i.test(trimmed)) return true;
  const pathOnly = trimmed.split(/[?#]/)[0];
  return /^\/(category|product)\/+$/i.test(pathOnly);
}

/** Slide/banner destination that must not be published. Legacy rows with no type are left alone. */
export function campaignDestinationIssue(
  row: Record<string, unknown>,
  label: string,
): string | null {
  const type = row.ctaDestinationType;
  if (typeof type !== 'string' || !type) return null;
  const value = row.ctaDestinationValue;
  if (type === 'absolute_path') {
    if (value == null || value === '') return null;
    if (isIncompleteStorefrontHref(value)) {
      return `${label}: مسیر مقصد ناقص است. مسیرهایی مثل /category/ پذیرفته نمی‌شوند.`;
    }
    return null;
  }
  if (type === 'category' && parsePositiveInt(value) == null) {
    return `${label}: دسته مقصد را انتخاب کنید.`;
  }
  if (
    type === 'product' &&
    parsePositiveInt(value) == null &&
    parsePositiveInt(row.preferredProductId) == null
  ) {
    return `${label}: محصول مقصد را انتخاب کنید.`;
  }
  if (
    (type === 'brand_search' || type === 'search_query') &&
    !String(value ?? '').trim()
  ) {
    return `${label}: مقصد را کامل کنید.`;
  }
  return null;
}

export function incompleteSlideDestinationMessages(
  config: Record<string, unknown>,
): string[] {
  if (!Array.isArray(config.slides)) return [];
  const messages: string[] = [];
  config.slides.forEach((slide, index) => {
    if (!slide || typeof slide !== 'object' || Array.isArray(slide)) return;
    const issue = campaignDestinationIssue(
      slide as Record<string, unknown>,
      `اسلاید ${index + 1}`,
    );
    if (issue) messages.push(issue);
  });
  return messages;
}

/** Relative storefront paths only — blocks javascript:/external schemes. */
export function sanitizeStorefrontHref(
  raw: unknown,
  fallback = '/',
): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return fallback;
  if (trimmed.startsWith('//')) return fallback;
  if (/[\s\\]/.test(trimmed)) return fallback;
  if (/^[a-z]+:/i.test(trimmed)) return fallback;
  return trimmed.slice(0, 512);
}

/** Uploaded merchandising paths under /home only. */
export function sanitizeHomeUploadPath(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const trimmed = raw.trim().replace(/\\/g, '/');
  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (!normalized.startsWith('/home/')) return undefined;
  if (normalized.includes('..')) return undefined;
  if (!/^\/home\/[a-zA-Z0-9._-]+$/.test(normalized)) return undefined;
  return normalized;
}

export function parsePositiveInt(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

export function parseProductIdList(raw: unknown, max = 24): number[] {
  if (!Array.isArray(raw)) return [];
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    const id = parsePositiveInt(item);
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= max) break;
  }
  return ids;
}

export function isWithinSchedule(
  startAt: Date | null | undefined,
  endAt: Date | null | undefined,
  now = new Date(),
): boolean {
  if (startAt && now < startAt) return false;
  if (endAt && now > endAt) return false;
  return true;
}

export function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fail-soft */
  }
  return {};
}

export function resolveCampaignHref(config: CampaignSectionConfig): string {
  const type = config.ctaDestinationType ?? 'absolute_path';
  const value = config.ctaDestinationValue;
  switch (type) {
    case 'product': {
      const id = parsePositiveInt(value) ?? config.preferredProductId;
      return id != null ? `/product/${id}` : '/';
    }
    case 'category': {
      const id = parsePositiveInt(value);
      return id != null ? `/category/${id}` : '/category';
    }
    case 'search_query': {
      const q = String(value ?? '').trim();
      return q ? `/search?q=${encodeURIComponent(q.slice(0, 120))}` : '/search';
    }
    case 'brand_search': {
      const brand = String(value ?? '').trim();
      return brand
        ? `/search?q=${encodeURIComponent(brand.slice(0, 120))}`
        : '/search';
    }
    case 'newest_rail_category':
    case 'discount_rail_category':
      // Storefront resolves against live landing roots; keep a safe default.
      return sanitizeStorefrontHref(
        typeof value === 'string' ? value : undefined,
        '/category',
      );
    case 'absolute_path':
    default:
      return sanitizeStorefrontHref(
        value ?? (typeof config.ctaDestinationValue === 'string'
          ? config.ctaDestinationValue
          : undefined),
        '/',
      );
  }
}

export function normalizeCampaignConfig(
  raw: Record<string, unknown>,
): CampaignSectionConfig {
  const typeRaw = raw.ctaDestinationType;
  const ctaDestinationType = CTA_TYPES.includes(typeRaw as HomeCtaDestinationType)
    ? (typeRaw as HomeCtaDestinationType)
    : undefined;

  return {
    eyebrow:
      typeof raw.eyebrow === 'string' ? raw.eyebrow.slice(0, 64) : undefined,
    ctaLabel:
      typeof raw.ctaLabel === 'string' ? raw.ctaLabel.slice(0, 64) : undefined,
    ctaDestinationType,
    ctaDestinationValue:
      typeof raw.ctaDestinationValue === 'string' ||
      typeof raw.ctaDestinationValue === 'number'
        ? raw.ctaDestinationValue
        : undefined,
    desktopImagePath: sanitizeHomeUploadPath(raw.desktopImagePath),
    mobileImagePath: sanitizeHomeUploadPath(raw.mobileImagePath),
    preferredProductId: parsePositiveInt(raw.preferredProductId),
    galleryImageIndex:
      raw.galleryImageIndex == null
        ? undefined
        : Math.max(0, Math.floor(Number(raw.galleryImageIndex) || 0)),
    objectPositionDesktop:
      typeof raw.objectPositionDesktop === 'string'
        ? raw.objectPositionDesktop.slice(0, 32)
        : undefined,
    objectPositionMobile:
      typeof raw.objectPositionMobile === 'string'
        ? raw.objectPositionMobile.slice(0, 32)
        : undefined,
  };
}

function normalizeCampaignSlide(
  raw: unknown,
  index: number,
): CampaignSlideConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const title = typeof row.title === 'string' ? row.title.trim().slice(0, 128) : '';
  if (!title) return null;
  const idRaw = typeof row.id === 'string' ? row.id.trim() : '';
  const id = /^[a-zA-Z0-9_-]{1,64}$/.test(idRaw)
    ? idRaw
    : `slide-${index + 1}`;
  const typeRaw = row.ctaDestinationType;
  const ctaDestinationType = CTA_TYPES.includes(typeRaw as HomeCtaDestinationType)
    ? (typeRaw as HomeCtaDestinationType)
    : undefined;
  const orderRaw = Number(row.order);
  const order = Number.isFinite(orderRaw) ? Math.floor(orderRaw) : index;
  const slide: CampaignSlideConfig = {
    id,
    enabled: row.enabled !== false && row.enabled !== 0 && row.enabled !== 'false',
    order,
    title,
  };
  if (typeof row.subtitle === 'string' && row.subtitle.trim()) {
    slide.subtitle = row.subtitle.trim().slice(0, 255);
  }
  if (typeof row.eyebrow === 'string' && row.eyebrow.trim()) {
    slide.eyebrow = row.eyebrow.trim().slice(0, 64);
  }
  if (typeof row.ctaLabel === 'string' && row.ctaLabel.trim()) {
    slide.ctaLabel = row.ctaLabel.trim().slice(0, 64);
  }
  if (ctaDestinationType) slide.ctaDestinationType = ctaDestinationType;
  if (
    typeof row.ctaDestinationValue === 'string' ||
    typeof row.ctaDestinationValue === 'number'
  ) {
    slide.ctaDestinationValue = row.ctaDestinationValue;
  }
  const desktop = sanitizeHomeUploadPath(row.desktopImagePath);
  const mobile = sanitizeHomeUploadPath(row.mobileImagePath);
  if (desktop) slide.desktopImagePath = desktop;
  if (mobile) slide.mobileImagePath = mobile;
  const preferred = parsePositiveInt(row.preferredProductId);
  if (preferred != null) slide.preferredProductId = preferred;
  if (typeof row.objectPositionDesktop === 'string') {
    slide.objectPositionDesktop = row.objectPositionDesktop.slice(0, 32);
  }
  if (typeof row.objectPositionMobile === 'string') {
    slide.objectPositionMobile = row.objectPositionMobile.slice(0, 32);
  }
  return slide;
}

/**
 * `slides` is omitted when the key is absent or not an array.
 * An empty array is kept so “no slides” is not confused with legacy mode.
 */
export function normalizeCampaignSlides(
  raw: Record<string, unknown>,
): CampaignSlideConfig[] | undefined {
  if (!Object.prototype.hasOwnProperty.call(raw, 'slides')) return undefined;
  if (!Array.isArray(raw.slides)) return undefined;
  const slides: CampaignSlideConfig[] = [];
  const seen = new Set<string>();
  raw.slides.forEach((item, index) => {
    const slide = normalizeCampaignSlide(item, index);
    if (!slide || seen.has(slide.id)) return;
    seen.add(slide.id);
    slides.push(slide);
  });
  slides.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return slides;
}

export function normalizeRailConfig(
  raw: Record<string, unknown>,
): RailSectionConfig {
  const source = RAIL_SOURCES.includes(raw.source as HomeRailSource)
    ? (raw.source as HomeRailSource)
    : undefined;
  const fallbackSource = RAIL_SOURCES.includes(
    raw.fallbackSource as HomeRailSource,
  )
    ? (raw.fallbackSource as HomeRailSource)
    : undefined;
  const limit = parsePositiveInt(raw.limit);
  return {
    source,
    fallbackSource,
    limit: limit != null ? Math.min(limit, 48) : undefined,
    seeAllLabel:
      typeof raw.seeAllLabel === 'string'
        ? raw.seeAllLabel.slice(0, 64)
        : undefined,
    seeAllHref: optionalStorefrontHref(raw.seeAllHref),
    productIds: parseProductIdList(raw.productIds),
  };
}

/**
 * Categories section IDs use the canonical storefront navigation namespace.
 * Legacy source-category IDs are not auto-converted (no numeric guessing).
 * Unrelated edits preserve stored JSON via mergeHomeConfigForPersistence.
 * A one-time migration/resolver requires separate approval.
 */
export const HOME_CATEGORIES_ID_NAMESPACE = 'canonical' as const;

export function normalizeCategoriesConfig(
  raw: Record<string, unknown>,
): CategoriesSectionConfig {
  const limit = parsePositiveInt(raw.limit);
  const categoryIds = parseProductIdList(raw.categoryIds, 32);
  const presentationRaw = Array.isArray(raw.presentation)
    ? raw.presentation
    : [];
  const presentation = presentationRaw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const categoryId = parsePositiveInt(row.categoryId);
      if (categoryId == null) return null;
      return {
        categoryId,
        imagePath: sanitizeHomeUploadPath(row.imagePath),
        preferredProductId: parsePositiveInt(row.preferredProductId),
        objectPosition:
          typeof row.objectPosition === 'string'
            ? row.objectPosition.slice(0, 32)
            : undefined,
      };
    })
    .filter(Boolean) as CategoriesSectionConfig['presentation'];

  return {
    limit: limit != null ? Math.min(limit, 24) : undefined,
    categoryIds: categoryIds.length ? categoryIds : undefined,
    presentation,
  };
}

export function normalizeEditorialConfig(
  raw: Record<string, unknown>,
): EditorialSectionConfig {
  return {
    ctaLabel:
      typeof raw.ctaLabel === 'string' ? raw.ctaLabel.slice(0, 64) : undefined,
    ctaHref: optionalStorefrontHref(raw.ctaHref),
    preferredProductId: parsePositiveInt(raw.preferredProductId),
    productIds: parseProductIdList(raw.productIds, 12),
    galleryImageIndex:
      raw.galleryImageIndex == null
        ? undefined
        : Math.max(0, Math.floor(Number(raw.galleryImageIndex) || 0)),
    desktopImagePath: sanitizeHomeUploadPath(raw.desktopImagePath),
    objectPosition:
      typeof raw.objectPosition === 'string'
        ? raw.objectPosition.slice(0, 32)
        : undefined,
  };
}

function normalizeSurfaceTone(raw: unknown): HomeSurfaceTone | undefined {
  if (typeof raw !== 'string') return undefined;
  return (HOME_SURFACE_TONES as readonly string[]).includes(raw)
    ? (raw as HomeSurfaceTone)
    : undefined;
}

function normalizeCategoryChapter(
  raw: unknown,
): CategoryChapterConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const categoryId = parsePositiveInt(row.categoryId);
  if (categoryId == null) return null;

  const order = parsePositiveInt(row.order);
  const limit = parsePositiveInt(row.limit);
  const source = RAIL_SOURCES.includes(row.source as HomeRailSource)
    ? (row.source as HomeRailSource)
    : undefined;

  return {
    enabled: row.enabled === false ? false : true,
    order: order ?? undefined,
    categoryId,
    title: typeof row.title === 'string' ? row.title.slice(0, 128) : undefined,
    subtitle:
      typeof row.subtitle === 'string' ? row.subtitle.slice(0, 255) : undefined,
    imagePath: sanitizeHomeUploadPath(row.imagePath),
    preferredProductId: parsePositiveInt(row.preferredProductId),
    source,
    productIds: parseProductIdList(row.productIds, 24),
    limit: limit != null ? Math.min(limit, 24) : undefined,
    ctaLabel:
      typeof row.ctaLabel === 'string' ? row.ctaLabel.slice(0, 64) : undefined,
    ctaHref: optionalStorefrontHref(row.ctaHref),
    startAt: typeof row.startAt === 'string' ? row.startAt.slice(0, 40) : undefined,
    endAt: typeof row.endAt === 'string' ? row.endAt.slice(0, 40) : undefined,
    surfaceTone: normalizeSurfaceTone(row.surfaceTone),
  };
}

export function normalizeCategoryChaptersConfig(
  raw: Record<string, unknown>,
): CategoryChaptersSectionConfig {
  const limit = parsePositiveInt(raw.limit);
  const chaptersRaw = Array.isArray(raw.chapters) ? raw.chapters : [];
  const chapters = chaptersRaw
    .map(normalizeCategoryChapter)
    .filter(Boolean) as CategoryChapterConfig[];

  return {
    limit: limit != null ? Math.min(limit, 12) : undefined,
    chapters: chapters.length ? chapters.slice(0, 12) : undefined,
  };
}

export function assertSectionKey(value: unknown): StorefrontHomeSectionKey {
  if (!isStorefrontHomeSectionKey(value)) {
    throw new Error(`Invalid Home section key: ${String(value)}`);
  }
  return value;
}

/** Fix sanitizeStorefrontHref optional fallback misuse for optional fields. */
export function optionalStorefrontHref(raw: unknown): string | undefined {
  if (raw == null || raw === '') return undefined;
  const href = sanitizeStorefrontHref(raw, '');
  return href || undefined;
}

/** Sections with no Admin-editable config schema. */
export const LIMITED_HOME_SECTION_KEYS = [
  'link_shopping',
  'quick_guide',
  'featured_brands',
  'paste_link',
] as const;

export type LimitedHomeSectionKey = (typeof LIMITED_HOME_SECTION_KEYS)[number];

export function isLimitedHomeSectionKey(
  key: string,
): key is LimitedHomeSectionKey {
  return (LIMITED_HOME_SECTION_KEYS as readonly string[]).includes(key);
}

/**
 * Top-level keys owned by each section normalizer.
 * Keys outside this allowlist that already exist in storage are preserved.
 * Client-supplied keys outside the allowlist are ignored.
 */
export const KNOWN_HOME_CONFIG_KEYS: Record<
  StorefrontHomeSectionKey,
  readonly string[]
> = {
  campaign: [
    'eyebrow',
    'ctaLabel',
    'ctaDestinationType',
    'ctaDestinationValue',
    'desktopImagePath',
    'mobileImagePath',
    'preferredProductId',
    'galleryImageIndex',
    'objectPositionDesktop',
    'objectPositionMobile',
    'slides',
  ],
  newest: [
    'source',
    'fallbackSource',
    'limit',
    'seeAllLabel',
    'seeAllHref',
    'productIds',
  ],
  discounts: [
    'source',
    'fallbackSource',
    'limit',
    'seeAllLabel',
    'seeAllHref',
    'productIds',
  ],
  categories: ['limit', 'categoryIds', 'presentation'],
  editorial_promo: [
    'ctaLabel',
    'ctaHref',
    'preferredProductId',
    'productIds',
    'galleryImageIndex',
    'desktopImagePath',
    'objectPosition',
  ],
  category_chapters: ['limit', 'chapters'],
  category_spotlight: ['limit'],
  link_shopping: [],
  quick_guide: [],
  featured_brands: [],
  paste_link: [],
};

export function compactConfigObject(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw || {})) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Preserve previous unknown fields on array rows matched by stable identity.
 * Client-invented keys on the new rows are not copied in — only prior unknowns.
 */
export function mergeUnknownFieldsByIdentity(
  nextRows: Array<Record<string, unknown>> | undefined,
  previousRows: unknown,
  identityKey: string,
  knownRowKeys: readonly string[],
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(nextRows)) return nextRows;
  const previous = Array.isArray(previousRows) ? previousRows : [];
  const known = new Set(knownRowKeys);
  return nextRows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row || {})) {
      if (known.has(k) && v !== undefined) out[k] = v;
    }
    const id = out[identityKey];
    const prior = previous.find(
      (item) =>
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        (item as Record<string, unknown>)[identityKey] === id,
    ) as Record<string, unknown> | undefined;
    if (prior) {
      for (const [k, v] of Object.entries(prior)) {
        if (!known.has(k)) out[k] = v;
      }
    }
    return out;
  });
}

const PRESENTATION_KNOWN_KEYS = [
  'categoryId',
  'imagePath',
  'preferredProductId',
  'objectPosition',
] as const;

const CHAPTER_KNOWN_KEYS = [
  'enabled',
  'order',
  'categoryId',
  'title',
  'subtitle',
  'imagePath',
  'preferredProductId',
  'source',
  'productIds',
  'limit',
  'ctaLabel',
  'ctaHref',
  'startAt',
  'endAt',
  'surfaceTone',
] as const;

/**
 * Merge normalized known fields with previously stored unknown keys.
 * Does not copy unknown keys from the client payload.
 * Nested presentation/chapter unknowns are preserved by categoryId identity.
 */
export function mergeHomeConfigForPersistence(
  key: StorefrontHomeSectionKey,
  normalized: Record<string, unknown>,
  previous: Record<string, unknown>,
): Record<string, unknown> {
  const allow = new Set(KNOWN_HOME_CONFIG_KEYS[key] ?? []);
  const out = compactConfigObject(normalized);
  for (const [storedKey, storedValue] of Object.entries(previous || {})) {
    if (!allow.has(storedKey)) {
      out[storedKey] = storedValue;
    }
  }
  if (
    key === 'campaign' &&
    !Object.prototype.hasOwnProperty.call(normalized, 'slides') &&
    Object.prototype.hasOwnProperty.call(previous || {}, 'slides')
  ) {
    out.slides = previous.slides;
  }

  if (key === 'categories' && Array.isArray(out.presentation)) {
    out.presentation = mergeUnknownFieldsByIdentity(
      out.presentation as Array<Record<string, unknown>>,
      previous?.presentation,
      'categoryId',
      PRESENTATION_KNOWN_KEYS,
    );
  }
  if (key === 'category_chapters' && Array.isArray(out.chapters)) {
    out.chapters = mergeUnknownFieldsByIdentity(
      out.chapters as Array<Record<string, unknown>>,
      previous?.chapters,
      'categoryId',
      CHAPTER_KNOWN_KEYS,
    );
  }

  return out;
}
