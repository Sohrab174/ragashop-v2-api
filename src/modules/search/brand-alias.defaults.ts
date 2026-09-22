/**
 * Authoritative default brand aliases for Search V1.
 * Resolved to brandId at migration/seed time by matching brand.sourceName / name.
 * Future Admin can manage rows in `brand_alias` without rewriting Search.
 */

export type BrandAliasDefaultGroup = {
  /** Stable key for ops/admin — not a source retailer id. */
  key: string;
  /** Match brand rows by normalized sourceName or name. */
  brandMatchers: string[];
  aliases: string[];
};

export const BRAND_ALIAS_DEFAULTS: BrandAliasDefaultGroup[] = [
  {
    key: 'nike',
    brandMatchers: ['nike', 'نایک', 'نايك'],
    aliases: ['Nike', 'nike', 'نایک', 'نایکی', 'نايك', 'نايكي'],
  },
  {
    key: 'adidas',
    brandMatchers: ['adidas', 'آدیداس', 'ادیداس'],
    aliases: ['Adidas', 'adidas', 'آدیداس', 'ادیداس', 'آديداس'],
  },
  {
    key: 'puma',
    brandMatchers: ['puma', 'پوما'],
    aliases: ['Puma', 'puma', 'پوما'],
  },
  {
    key: 'zara',
    brandMatchers: ['zara', 'زارا'],
    aliases: ['Zara', 'zara', 'زارا'],
  },
];
