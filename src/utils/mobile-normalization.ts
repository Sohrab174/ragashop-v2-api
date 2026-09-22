import {
  convertPersianToEnglishDigit,
  convertToStandardMobileFormat,
} from './persianNumbers';

/**
 * Authoritative mobile normalization for lookup, creation, and identity comparison.
 */
export function normalizeCustomerMobile(
  mobile: string | null | undefined,
): string {
  if (mobile == null || mobile === '') {
    return '';
  }

  let input = convertPersianToEnglishDigit(String(mobile).trim());
  input = input.replace(/[\s\-()]/g, '');

  if (!input) {
    return '';
  }

  if (input.startsWith('+')) {
    return input;
  }

  if (input.startsWith('00989') && input.length >= 13) {
    return `+${input.slice(2)}`;
  }

  if (input.startsWith('0098') && input.length >= 13) {
    return `+${input.slice(2)}`;
  }

  if (/^989\d{9}$/.test(input)) {
    return `+${input}`;
  }

  return convertToStandardMobileFormat(input);
}

export function isNormalizedCustomerMobile(mobile: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(mobile);
}
