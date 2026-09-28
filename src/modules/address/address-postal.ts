import { prettyText } from '../../utils';

/**
 * Postal codes stay STRING forever (leading zeros matter).
 * Iran-first soft rule lives here — not in the DB schema.
 *
 * Profile: when the value is digit-only after normalize, require 10 digits
 * (Iran national postal code). Non-digit values pass with a max-length check
 * so the architecture stays internationally extensible.
 */
export const POSTAL_CODE_MAX = 45;
export const IRAN_DIGIT_POSTAL_LENGTH = 10;

export function normalizePostalCode(value: unknown): string | null | 'invalid' {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return 'invalid';
  const text = prettyText(String(value)).replace(/[\s\u200c\u200e\u200f-]+/g, '');
  if (!text) return null;
  if (text.length > POSTAL_CODE_MAX) return 'invalid';
  return text;
}

export function postalCodeFieldError(value: unknown): string | null {
  const normalized = normalizePostalCode(value);
  if (normalized === 'invalid') return 'کد پستی طولانی است';
  if (normalized == null) return null;
  if (/^\d+$/.test(normalized) && normalized.length !== IRAN_DIGIT_POSTAL_LENGTH) {
    return 'کد پستی باید ۱۰ رقم باشد';
  }
  return null;
}
