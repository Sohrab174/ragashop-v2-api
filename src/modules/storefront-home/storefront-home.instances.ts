export const HOME_LAYOUT_MARKER_KEY = 'layout:published';
export const HOME_LAYOUT_SECTION_TYPE = 'layout';
export const HOME_INSTANCE_LIMIT = 24;

export const HOME_REPEATABLE_SECTION_TYPES = [
  'hero',
  'promo_banner',
  'product_rail',
  'brand_rail',
  'category',
  'rich_text',
] as const;

export type HomeRepeatableSectionType =
  (typeof HOME_REPEATABLE_SECTION_TYPES)[number];

/** Singleton editor key used only to reuse the existing public mapper. */
export const HOME_INSTANCE_EDITOR_KEYS: Record<
  HomeRepeatableSectionType,
  string
> = {
  hero: 'campaign',
  promo_banner: 'editorial_promo',
  product_rail: 'discounts',
  brand_rail: 'featured_brands',
  category: 'category_chapters',
  rich_text: 'site_intro',
};

const LEGACY_INSTANCE_TYPES: Record<string, HomeRepeatableSectionType> = {
  'legacy:campaign': 'hero',
  'legacy:discounts': 'product_rail',
  'legacy:featured_brands': 'brand_rail',
  'legacy:category_chapters': 'category',
  'legacy:site_intro': 'rich_text',
};

const FORBIDDEN_TYPES = new Set([
  'site_header',
  'site_footer',
  'paste_link',
  'search',
  'checkout',
  'categories',
  HOME_LAYOUT_SECTION_TYPE,
]);

export type HomeInstanceInput = {
  instanceKey?: string;
  sectionType?: string;
  enabled?: boolean;
  displayOrder?: number;
  title?: string | null;
  subtitle?: string | null;
  config?: unknown;
};

export type NormalizedHomeInstance = {
  instanceKey: string;
  sectionType: HomeRepeatableSectionType;
  enabled: boolean;
  displayOrder: number;
  title: string | null;
  subtitle: string | null;
  config: Record<string, unknown>;
};

export function normalizeHomeArrangement(
  instances: unknown,
): { ok: true; instances: NormalizedHomeInstance[] } | { ok: false; message: string } {
  if (!Array.isArray(instances)) {
    return { ok: false, message: 'چیدمان صفحه باید یک فهرست باشد' };
  }
  if (instances.length > HOME_INSTANCE_LIMIT) {
    return { ok: false, message: 'تعداد بخش‌های تکرارشونده بیش از حد مجاز است' };
  }
  const seen = new Set<string>();
  const normalized: NormalizedHomeInstance[] = [];
  for (const raw of instances as HomeInstanceInput[]) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, message: 'بخش نامعتبر است' };
    }
    const instanceKey = String(raw.instanceKey || '').trim();
    const sectionType = String(raw.sectionType || '').trim();
    if (FORBIDDEN_TYPES.has(sectionType) || instanceKey.startsWith('layout:')) {
      return {
        ok: false,
        message: 'سربرگ، پاورقی، جستجو و تسویه در کتابخانه بخش‌ها قرار نمی‌گیرند',
      };
    }
    if (
      !HOME_REPEATABLE_SECTION_TYPES.includes(
        sectionType as HomeRepeatableSectionType,
      )
    ) {
      return { ok: false, message: 'نوع بخش نامعتبر است' };
    }
    const legacyType = LEGACY_INSTANCE_TYPES[instanceKey];
    const generated = /^inst_[a-f0-9]{16}$/.test(instanceKey);
    if (!legacyType && !generated) {
      return { ok: false, message: 'شناسه بخش نامعتبر است' };
    }
    if (legacyType && legacyType !== sectionType) {
      return { ok: false, message: 'نوع بخش قدیمی با شناسه آن یکی نیست' };
    }
    if (seen.has(instanceKey)) {
      return { ok: false, message: 'شناسه بخش تکراری است' };
    }
    seen.add(instanceKey);
    if (
      raw.config != null &&
      (typeof raw.config !== 'object' || Array.isArray(raw.config))
    ) {
      return { ok: false, message: 'پیکربندی بخش نامعتبر است' };
    }
    const config = (raw.config as Record<string, unknown>) || {};
    let encoded = '{}';
    try {
      encoded = JSON.stringify(config);
    } catch {
      return { ok: false, message: 'پیکربندی بخش نامعتبر است' };
    }
    if (encoded.length > 200000) {
      return { ok: false, message: 'پیکربندی بخش بزرگ‌تر از حد مجاز است' };
    }
    const order = Math.floor(Number(raw.displayOrder));
    normalized.push({
      instanceKey,
      sectionType: sectionType as HomeRepeatableSectionType,
      enabled: Boolean(raw.enabled),
      displayOrder: Number.isFinite(order) ? order : (normalized.length + 1) * 10,
      title: clip(raw.title, 128),
      subtitle: clip(raw.subtitle, 255),
      config,
    });
  }
  return { ok: true, instances: normalized };
}

function clip(value: unknown, max: number): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}
