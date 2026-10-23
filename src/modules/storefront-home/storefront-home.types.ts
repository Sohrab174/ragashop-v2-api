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
  'site_header',
  'site_intro',
  'site_footer',
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
  /** Circle label on the homepage. Catalog name stays authoritative when empty. */
  label?: string;
  hidden?: boolean;
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
  /** Automatic mobile WebP from master crop. */
  generatedMobileImagePath?: string;
  /** Optional dedicated mobile override (never replaced by master recrop). */
  mobileImageOverridePath?: string;
  preferredProductId?: number;
  objectPositionDesktop?: string;
  objectPositionMobile?: string;
  /** Retained private master for recrop (`/home-masters/...`). */
  masterImagePath?: string;
  /** Public low-res preview of the master for Admin focal UI. */
  masterPreviewPath?: string;
  imageProfile?: 'hero' | 'category' | 'pets';
  previousImage?: PreviousHomeImageSnapshot;
  compositionDesktop?: ImageCompositionConfig;
  compositionMobile?: ImageCompositionConfig;
};

export type ImageFitMode = 'cover' | 'contain' | 'manual';
export type ImageBackgroundMode = 'blur' | 'solid';

export type ImageCompositionConfig = {
  fit: ImageFitMode;
  zoom: number;
  panX: number;
  panY: number;
  backgroundMode: ImageBackgroundMode;
  backgroundColor: string;
};

/** One-step Admin restore snapshot (mirrors validate.PreviousHomeImageSnapshot). */
export type PreviousHomeImageSnapshot = {
  desktopImagePath?: string;
  mobileImagePath?: string;
  generatedMobileImagePath?: string;
  mobileImageOverridePath?: string;
  mobileWideImagePath?: string;
  imagePath?: string;
  masterImagePath?: string;
  masterPreviewPath?: string;
  imageProfile?: 'hero' | 'category' | 'pets';
  objectPositionDesktop?: string;
  objectPositionMobile?: string;
  compositionDesktop?: ImageCompositionConfig;
  compositionMobile?: ImageCompositionConfig;
};

export type CampaignSectionConfig = {
  eyebrow?: string;
  ctaLabel?: string;
  ctaDestinationType?: HomeCtaDestinationType;
  ctaDestinationValue?: string | number;
  desktopImagePath?: string;
  mobileImagePath?: string;
  generatedMobileImagePath?: string;
  mobileImageOverridePath?: string;
  preferredProductId?: number;
  galleryImageIndex?: number;
  objectPositionDesktop?: string;
  objectPositionMobile?: string;
  masterImagePath?: string;
  masterPreviewPath?: string;
  imageProfile?: 'hero' | 'category' | 'pets';
  /** Immediate previous desktop/mobile + focal snapshot for Admin restore. */
  previousImage?: PreviousHomeImageSnapshot;
  compositionDesktop?: ImageCompositionConfig;
  compositionMobile?: ImageCompositionConfig;
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
  /** Desktop banner. Empty falls back to imagePath, then the autumn photo. */
  desktopImagePath?: string;
  /** Mobile banner. Empty falls back to imagePath, then the desktop image. */
  mobileImagePath?: string;
  preferredProductId?: number;
  /** CSS object-position for the desktop banner frame. */
  objectPositionDesktop?: string;
  /** CSS object-position for the mobile banner frame. */
  objectPositionMobile?: string;
  masterImagePath?: string;
  masterPreviewPath?: string;
  /** Wide ≈2.15:1 mobile crop for odd-last Concept D banners. */
  mobileWideImagePath?: string;
  /** Master processing profile used for this chapter (category | pets only). */
  imageProfile?: 'category' | 'pets';
  previousImage?: PreviousHomeImageSnapshot;
  compositionDesktop?: ImageCompositionConfig;
  compositionMobile?: ImageCompositionConfig;
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
  /** Sharp mobile composition fit — storefront must not re-crop `contain`. */
  imageFitMobile?: 'cover' | 'contain' | 'manual';
  imageFitDesktop?: 'cover' | 'contain' | 'manual';
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
  imageFitMobile?: 'cover' | 'contain' | 'manual';
  imageFitDesktop?: 'cover' | 'contain' | 'manual';
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
  label?: string;
  hidden?: boolean;
};

export type PublicHomeLinkDto = {
  label: string;
  href: string;
};

export type PublicHomeBrandOverrideDto = {
  brandId: number;
  logoUrl: string | null;
  order: number;
  enabled: boolean;
};

export type PublicHomeSectionDto = {
  key: StorefrontHomeSectionKey;
  enabled: boolean;
  order: number;
  title?: string;
  subtitle?: string;
  /** Trendyol bar button when the Admin set one. */
  ctaLabel?: string;
  header?: {
    logoUrl: string | null;
    wordmark?: string;
    links: PublicHomeLinkDto[];
  };
  intro?: {
    kicker?: string;
    imageUrl: string | null;
    links?: PublicHomeLinkDto[];
  };
  footer?: {
    logoUrl: string | null;
    groups?: Array<{ title: string; links: PublicHomeLinkDto[] }>;
    social: PublicHomeLinkDto[];
  };
  brands?: PublicHomeBrandOverrideDto[];
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
    /**
     * `managed` — Admin sent an explicit `chapters` array (possibly empty).
     * Omitted — legacy/default config (including `{}`); clients may auto-fill.
     */
    chaptersMode?: 'managed';
    chapters: Array<{
      enabled: boolean;
      order: number;
      categoryId: number;
      title?: string;
      subtitle?: string;
      imageUrl: string | null;
      desktopImageUrl: string | null;
      mobileImageUrl: string | null;
      /** Wide ≈2.15:1 mobile asset for odd-last showcase banners. */
      mobileWideImageUrl?: string | null;
      /** @deprecated Prefer objectPositionDesktop; kept for older clients. */
      objectPosition?: string;
      objectPositionDesktop?: string;
      objectPositionMobile?: string;
      /** Sharp composition fit — storefront must not re-crop Contain/Manual WebPs. */
      imageFitDesktop?: 'cover' | 'contain' | 'manual';
      imageFitMobile?: 'cover' | 'contain' | 'manual';
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

export type PublicHomeInstanceDto = {
  instanceKey: string;
  sectionType: string;
  enabled: boolean;
  order: number;
  title?: string;
  subtitle?: string;
  section: PublicHomeSectionDto;
};

export type PublicHomeLayoutDto = {
  managed: true;
  instances: PublicHomeInstanceDto[];
};

export type PublicStorefrontHomeDto = {
  sections: PublicHomeSectionDto[];
  /**
   * Present only after an arrangement has been published.
   * `instances: []` is an intentional empty body and must not fall back
   * to singleton sections.
   */
  layout?: PublicHomeLayoutDto;
};
