import type {
  CampaignSectionConfig,
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
