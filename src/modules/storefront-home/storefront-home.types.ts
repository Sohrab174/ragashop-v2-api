/**
 * Typed Home section keys — application architecture whitelist.
 * Admin cannot invent arbitrary executable component names.
 */
export const STOREFRONT_HOME_SECTION_KEYS = [
  'link_shopping',
  'quick_guide',
  'campaign',
  'categories',
  'featured_brands',
  'newest',
  'editorial_promo',
  'category_spotlight',
  'discounts',
  'category_chapters',
  'paste_link',
] as const;

/** Approved HOME-3 surface washes — presentation hint only. */
export const HOME_SURFACE_TONES = [
  'default',
  'blush',
  'slate',
  'apricot',
  'rose',
  'sand',
  'silver',
  'mint',
] as const;

export type HomeSurfaceTone = (typeof HOME_SURFACE_TONES)[number];

export type StorefrontHomeSectionKey =
  (typeof STOREFRONT_HOME_SECTION_KEYS)[number];

export function isStorefrontHomeSectionKey(
  value: unknown,
): value is StorefrontHomeSectionKey {
  return (
    typeof value === 'string' &&
    (STOREFRONT_HOME_SECTION_KEYS as readonly string[]).includes(value)
  );
}

export type HomeCtaDestinationType =
  | 'product'
  | 'category'
  | 'search_query'
  | 'brand_search'
  | 'newest_rail_category'
  | 'discount_rail_category'
  | 'absolute_path';

export type HomeRailSource = 'newest' | 'discount' | 'curated';

export type CategoryPresentationConfig = {
  categoryId: number;
  imagePath?: string;
  preferredProductId?: number;
  objectPosition?: string;
};

export type CampaignSlideConfig = {
  id: string;
  enabled: boolean;
  order: number;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  ctaLabel?: string;
  ctaDestinationType?: HomeCtaDestinationType;
  ctaDestinationValue?: string | number;
  desktopImagePath?: string;
  mobileImagePath?: string;
  preferredProductId?: number;
  objectPositionDesktop?: string;
  objectPositionMobile?: string;
};

export type CampaignSectionConfig = {
  eyebrow?: string;
  ctaLabel?: string;
  ctaDestinationType?: HomeCtaDestinationType;
  ctaDestinationValue?: string | number;
  desktopImagePath?: string;
  mobileImagePath?: string;
  preferredProductId?: number;
  galleryImageIndex?: number;
  objectPositionDesktop?: string;
  objectPositionMobile?: string;
  /**
   * Present only when Admin sent `slides` (including []).
   * Omitted means the legacy single campaign is still the hero.
   */
  slides?: CampaignSlideConfig[];
};

export type RailSectionConfig = {
  source?: HomeRailSource;
  fallbackSource?: HomeRailSource;
  limit?: number;
  seeAllLabel?: string;
  seeAllHref?: string;
  productIds?: number[];
};

export type CategoriesSectionConfig = {
  limit?: number;
  categoryIds?: number[];
  presentation?: CategoryPresentationConfig[];
};

export type EditorialSectionConfig = {
  ctaLabel?: string;
  ctaHref?: string;
  preferredProductId?: number;
  /** Curated associated products for RagaShop Edit chapter (catalog ids). */
  productIds?: number[];
  galleryImageIndex?: number;
  desktopImagePath?: string;
  objectPosition?: string;
};

/**
 * One reusable category merchandising chapter (Women/Men/Kids/…).
 * Catalog refs are data — not frontend hard-coded maps.
 */
export type CategoryChapterConfig = {
  enabled?: boolean;
  order?: number;
  /** Canonical category id. */
  categoryId: number;
  title?: string;
  subtitle?: string;
  imagePath?: string;
  preferredProductId?: number;
  source?: HomeRailSource;
  productIds?: number[];
  limit?: number;
  ctaLabel?: string;
  ctaHref?: string;
  startAt?: string;
  endAt?: string;
  surfaceTone?: HomeSurfaceTone;
};

export type CategoryChaptersSectionConfig = {
  /** Max auto chapters when `chapters` empty (storefront may also auto-fill). */
  limit?: number;
  chapters?: CategoryChapterConfig[];
};

/** Public presentation — no Admin metadata / private storage paths as-is. */
export type PublicHomeHeroDto = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  ctaLabel: string;
  ctaHref: string;
  desktopImageUrl: string | null;
  mobileImageUrl: string | null;
  objectPositionDesktop?: string;
  objectPositionMobile?: string;
  /** Resolved preferred product when imagery comes from catalog — no Admin notes. */
  preferredProductId?: number;
  /**
   * `managed` — `slides` is the enabled list (possibly empty).
   * Omitted — legacy single campaign; clients must ignore `slides`.
   */
  slideMode?: 'managed';
  slides?: PublicHomeHeroSlideDto[];
};

export type PublicHomeHeroSlideDto = {
  id: string;
  order: number;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  ctaLabel: string;
  ctaHref: string;
  desktopImageUrl: string | null;
  mobileImageUrl: string | null;
  objectPositionDesktop?: string;
  objectPositionMobile?: string;
  preferredProductId?: number;
};

export type PublicHomeRailDto = {
  source: HomeRailSource;
  limit: number;
  seeAllLabel?: string;
  seeAllHref?: string;
  /** Validated active catalog product ids only. */
  productIds: number[];
};

export type PublicCategoryPresentationDto = {
  categoryId: number;
  imageUrl: string | null;
  objectPosition?: string;
  /** Catalog product used for presentation imagery when no upload override. */
  preferredProductId?: number;
};

export type PublicHomeSectionDto = {
  key: StorefrontHomeSectionKey;
  enabled: boolean;
  order: number;
  title?: string;
  subtitle?: string;
  hero?: PublicHomeHeroDto;
  rail?: PublicHomeRailDto;
  categories?: {
    limit: number;
    categoryIds: number[];
    presentation: PublicCategoryPresentationDto[];
  };
  editorial?: {
    title?: string;
    subtitle?: string;
    ctaLabel?: string;
    ctaHref?: string;
    imageUrl: string | null;
    objectPosition?: string;
    preferredProductId?: number;
    /** Active curated catalog product ids for the Edit chapter. */
    productIds?: number[];
  };
  spotlight?: { limit: number };
  categoryChapters?: {
    limit: number;
    chapters: Array<{
      enabled: boolean;
      order: number;
      categoryId: number;
      title?: string;
      subtitle?: string;
      imageUrl: string | null;
      objectPosition?: string;
      preferredProductId?: number;
      source: HomeRailSource;
      productIds: number[];
      limit: number;
      ctaLabel?: string;
      ctaHref?: string;
      startAt?: string;
      endAt?: string;
      surfaceTone?: HomeSurfaceTone;
    }>;
  };
};

export type PublicStorefrontHomeDto = {
  sections: PublicHomeSectionDto[];
};
