/**
 * SCOPE-3/4 — Persian business labels for assortment policy (pure).
 * Machine enums stay intact underneath Admin UI.
 */

import { AssortmentPolicyStatus } from './assortment-policy.types';

export const ASSORTMENT_STATUS_LABEL_FA: Record<AssortmentPolicyStatus, string> =
  {
    IN_SCOPE: 'فعال در فروشگاه',
    REVIEW_REQUIRED: 'نیازمند تصمیم',
    OUT_OF_SCOPE: 'خارج از حوزه فروش',
  };

export const ASSORTMENT_REASON_LABEL_FA: Record<string, string> = {
  TARGET_FASHION: 'پوشاک هدف فروشگاه',
  TARGET_ACCESSORY: 'اکسسوری هدف فروشگاه',
  TARGET_BEAUTY: 'زیبایی و مراقبت هدف فروشگاه',
  TARGET_EXISTING_CANONICAL_ROOT: 'هم‌راستا با شاخه فروشگاهی موجود',
  BULKY_FURNITURE: 'کالای حجیم / مبلمان',
  BULKY_HEAVY: 'کالای حجیم یا سنگین',
  HOME_GOODS_NOT_YET_DECIDED: 'درباره فروش این گروه هنوز تصمیم‌گیری نشده',
  HEAVY_TEXTILE_SIZE_UNKNOWN: 'منسوجات حجیم با ابعاد نامشخص',
  FRAGILE_OR_BULKY: 'شکننده یا حجیم',
  SENSITIVE_ADULT: 'کالای حساس / بزرگسال',
  SAFETY_REGULATED: 'نیازمند بررسی به دلیل شرایط ایمنی یا محدودیت فروش',
  KIDS_GOODS_NOT_YET_DECIDED: 'نیازمند تصمیم برای حوزه کودک',
  BULKY_EXISTING_CANONICAL: 'حجیم ولی دارای مقصد فروشگاهی موجود',
  BULKY_BATTERY_EXISTING_CANONICAL: 'باتری‌دار حجیم با مقصد موجود',
  NOT_TARGETED_YET: 'هنوز در هدف فروشگاه نیست',
  UNCLASSIFIED: 'هنوز طبقه‌بندی تجاری نشده',
  MIXED_DESCENDANT_POLICY: 'زیرمجموعه‌ها تصمیم‌های متفاوت دارند',
  DOMAIN_DEFAULT: 'پیش‌فرض حوزه تجاری',
  EMPLOYEE_OVERRIDE: 'تصمیم ثبت‌شده توسط کارمند',
};

export const ASSORTMENT_VIA_LABEL_FA: Record<string, string> = {
  category_override: 'تصمیم صریح روی این دسته',
  provider_path: 'قاعده مسیر منبع',
  descendants: 'اجماع زیرمجموعه‌ها',
  domain_default: 'پیش‌فرض حوزه',
  unclassified: 'بدون قاعده مشخص',
};

export const ASSORTMENT_DOMAIN_LABEL_FA: Record<string, string> = {
  fashion_apparel: 'پوشاک',
  fashion_accessory: 'اکسسوری',
  beauty: 'زیبایی',
  home_furniture: 'مبلمان',
  home_goods: 'لوازم خانگی کوچک',
  home_textile: 'منسوجات خانگی',
  kids_goods: 'کالای کودک',
  sport: 'ورزش',
  electronics: 'الکترونیک',
  sensitive: 'حساس',
  other: 'سایر',
};

export function assortmentStatusLabelFa(status: string | null | undefined): string {
  if (!status) return '—';
  return ASSORTMENT_STATUS_LABEL_FA[status as AssortmentPolicyStatus] || status;
}

export function assortmentReasonLabelFa(code: string | null | undefined): string {
  if (!code) return '—';
  return ASSORTMENT_REASON_LABEL_FA[code] || code;
}

export function assortmentViaLabelFa(via: string | null | undefined): string {
  if (!via) return '—';
  return ASSORTMENT_VIA_LABEL_FA[via] || via;
}

export function assortmentDomainLabelFa(
  domain: string | null | undefined,
): string {
  if (!domain) return '—';
  return ASSORTMENT_DOMAIN_LABEL_FA[domain] || domain;
}
