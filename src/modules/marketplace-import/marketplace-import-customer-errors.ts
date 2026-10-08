export type CustomerMarketplaceImportErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_SOURCE'
  | 'PRODUCT_NOT_FOUND'
  | 'SOURCE_TEMPORARILY_UNAVAILABLE'
  | 'IMPORT_FAILED'
  | 'INVALID_PRODUCT_DATA'
  | 'PRODUCT_UNAVAILABLE'
  | 'PRODUCT_NOT_ORDERABLE'
  | 'PRODUCT_REVIEW_REQUIRED';

const CUSTOMER_SAFE_MESSAGES: Record<
  CustomerMarketplaceImportErrorCode,
  string
> = {
  INVALID_URL: 'لینک وارد شده معتبر نیست.',
  UNSUPPORTED_SOURCE: 'این فروشگاه در حال حاضر پشتیبانی نمی‌شود.',
  PRODUCT_NOT_FOUND: 'محصولی یافت نشد.',
  SOURCE_TEMPORARILY_UNAVAILABLE:
    'دریافت اطلاعات محصول موقتاً با مشکل مواجه شد. لطفاً کمی بعد دوباره تلاش کنید.',
  IMPORT_FAILED: 'دریافت اطلاعات محصول با خطا مواجه شد.',
  INVALID_PRODUCT_DATA: 'اطلاعات محصول معتبر نیست.',
  PRODUCT_UNAVAILABLE: 'این محصول در حال حاضر قابل خرید نیست.',
  PRODUCT_NOT_ORDERABLE:
    'این کالا در حال حاضر از طریق راگاشاپ قابل سفارش نیست.',
  PRODUCT_REVIEW_REQUIRED: 'امکان خرید و ارسال این کالا نیاز به بررسی دارد.',
};

/** SCOPE-5/6 — assortment outcomes never fall through to generic failure. */
const ASSORTMENT_OUT_CODES = new Set([
  'ASSORTMENT_OUT_OF_SCOPE',
  'CATEGORY_OUT_OF_SCOPE',
]);
const ASSORTMENT_REVIEW_CODES = new Set([
  'ASSORTMENT_REVIEW_REQUIRED',
  'ASSORTMENT_UNRESOLVED',
  'CATEGORY_REVIEW_REQUIRED',
  'POLICY_UNAVAILABLE',
  'POLICY_STALE',
]);

const INVALID_URL_CODES = new Set([
  'INVALID_URL',
  'URL_TOO_LONG',
  'UNSUPPORTED_PROTOCOL',
  'CREDENTIALS_IN_URL',
  'UNEXPECTED_PORT',
  'FRAGMENT_NOT_ALLOWED',
  'PRIVATE_DESTINATION',
  'INVALID_PAYLOAD',
  'LEGACY_URL_FIELD',
  'INVALID_PATH',
  'RESPONSE_TOO_LARGE',
]);

const UNSUPPORTED_SOURCE_CODES = new Set([
  'UNSUPPORTED_SOURCE',
  'UNSUPPORTED_MARKETPLACE',
  'UNSUPPORTED_PRODUCT_URL',
  'UNSUPPORTED_HOST',
  'UNSUPPORTED_PRODUCT_PATH',
  'UNSUPPORTED_NAVIGATION',
]);

const PRODUCT_NOT_FOUND_CODES = new Set([
  'PRODUCT_NOT_FOUND',
  'SOURCE_UNAVAILABLE',
]);

const PRODUCT_UNAVAILABLE_CODES = new Set(['PRODUCT_UNAVAILABLE']);

const INVALID_PRODUCT_DATA_CODES = new Set([
  'INVALID_PRODUCT_DATA',
  'VALIDATION_FAILED',
  'CRAWLER_VALIDATION_FAILED',
  'INVALID_PRODUCT_ID',
  'INVALID_SOURCE_URL',
  'IDENTITY_MISMATCH',
]);

const TEMPORARY_CODES = new Set([
  'SOURCE_TEMPORARILY_UNAVAILABLE',
  'REDIRECT_TIMEOUT',
  'REDIRECT_FAILED',
  'REDIRECT_CHAIN_TOO_LONG',
  'CRAWLER_UNAVAILABLE',
  'IMPORT_BUSY',
  'IMPORT_IN_PROGRESS',
  'DB_TEMPORARY',
  'UNKNOWN',
  'CLAIM_EXPIRED',
  'HTTP_429',
  'HTTP_502',
  'HTTP_503',
  'HTTP_504',
  'CRAWLER_HTTP_429',
  'CRAWLER_HTTP_502',
  'CRAWLER_HTTP_503',
  'CRAWLER_HTTP_504',
  'CRAWLER_HTTP_500',
]);

export function toCustomerSafeImportError(
  code?: string | null,
  message?: string | null,
): {
  code: CustomerMarketplaceImportErrorCode;
  message: string;
} {
  const mapped = mapCustomerSafeErrorCode(code);
  if (
    mapped === 'PRODUCT_NOT_ORDERABLE' ||
    mapped === 'PRODUCT_REVIEW_REQUIRED'
  ) {
    // Fixed customer wording — never echo crawler/internal text.
    return { code: mapped, message: CUSTOMER_SAFE_MESSAGES[mapped] };
  }
  const safeMessage = isCustomerSafePublicMessage(message)
    ? (message as string).trim()
    : CUSTOMER_SAFE_MESSAGES[mapped];

  return {
    code: mapped,
    message: safeMessage || CUSTOMER_SAFE_MESSAGES[mapped],
  };
}

export function mapCustomerSafeErrorCode(
  code?: string | null,
): CustomerMarketplaceImportErrorCode {
  if (!code) {
    return 'IMPORT_FAILED';
  }

  if (ASSORTMENT_OUT_CODES.has(code)) return 'PRODUCT_NOT_ORDERABLE';
  if (ASSORTMENT_REVIEW_CODES.has(code)) return 'PRODUCT_REVIEW_REQUIRED';
  if (INVALID_URL_CODES.has(code)) return 'INVALID_URL';
  if (UNSUPPORTED_SOURCE_CODES.has(code)) return 'UNSUPPORTED_SOURCE';
  if (PRODUCT_NOT_FOUND_CODES.has(code)) return 'PRODUCT_NOT_FOUND';
  if (PRODUCT_UNAVAILABLE_CODES.has(code)) return 'PRODUCT_UNAVAILABLE';
  if (INVALID_PRODUCT_DATA_CODES.has(code)) return 'INVALID_PRODUCT_DATA';
  if (
    TEMPORARY_CODES.has(code) ||
    code.startsWith('CRAWLER_HTTP_') ||
    code.startsWith('HTTP_')
  ) {
    return 'SOURCE_TEMPORARILY_UNAVAILABLE';
  }

  return 'IMPORT_FAILED';
}

function isCustomerSafePublicMessage(message?: string | null): boolean {
  if (typeof message !== 'string') return false;
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 500) return false;
  const lowered = trimmed.toLowerCase();
  if (
    lowered.includes('econnrefused') ||
    lowered.includes('x-crawler-secret') ||
    lowered.includes('authorization') ||
    lowered.includes('stack') ||
    lowered.includes('gemini') ||
    lowered.includes('apigw.trendyol')
  ) {
    return false;
  }
  return true;
}
