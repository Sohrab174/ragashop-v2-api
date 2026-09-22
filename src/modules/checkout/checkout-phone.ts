import {
  normalizeCustomerMobile,
  isNormalizedCustomerMobile,
} from '../../utils/mobile-normalization';

/**
 * Checkout phone: reuse customer mobile normalization (E.164-ish).
 * Avoids brittle UI-only / Iran-prefix-only rules while remaining
 * compatible with current Iranian storefront inputs.
 */
export function normalizeCheckoutPhone(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const normalized = normalizeCustomerMobile(String(raw));
  return normalized || null;
}

export function isValidCheckoutPhone(normalized: string | null): boolean {
  if (!normalized) return false;
  return isNormalizedCustomerMobile(normalized);
}
