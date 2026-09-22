import { createHash } from 'crypto';
import {
  isNormalizedCustomerMobile,
  normalizeCustomerMobile,
} from '../utils/mobile-normalization';
import { convertPersianToEnglishDigit } from '../utils/persianNumbers';

const MAX_IDENTITY_KEY_LEN = 256;

/**
 * Rate-limit identity key for auth/OTP endpoints.
 * Phone-like values reuse normalizeCustomerMobile (authoritative customer
 * identity). Emails/usernames stay lowercase and are never +98-prefixed.
 */
export function normalizeAuthRateLimitIdentity(
  raw: string | null | undefined,
  fieldHint?: string,
): string {
  try {
    const trimmed = (raw == null ? '' : String(raw)).trim();
    if (!trimmed) {
      return 'anonymous';
    }

    const hint = (fieldHint || '').toLowerCase();

    if (hint === 'email' || trimmed.includes('@')) {
      return boundKey(trimmed.toLowerCase());
    }

    if (hint === 'mobile' || looksLikePhoneIdentity(trimmed)) {
      return canonicalizePhoneIdentity(trimmed);
    }

    return boundKey(trimmed.toLowerCase());
  } catch {
    return `malformed:${stableHash(String(raw ?? ''))}`;
  }
}

function canonicalizePhoneIdentity(raw: string): string {
  const normalized = normalizeCustomerMobile(raw);
  if (normalized && isNormalizedCustomerMobile(normalized)) {
    return boundKey(normalized);
  }
  if (normalized) {
    return boundKey(`phone:${normalized}`);
  }
  return `phone-raw:${stableHash(raw)}`;
}

/**
 * Gate only: decide whether to apply normalizeCustomerMobile.
 * Uses the same digit conversion + strip set as mobile-normalization.ts.
 */
export function looksLikePhoneIdentity(raw: string): boolean {
  if (!raw || raw.includes('@')) {
    return false;
  }

  let input = convertPersianToEnglishDigit(String(raw).trim());
  input = input.replace(/[\s\-()]/g, '');

  if (!input) {
    return false;
  }

  const core = input.startsWith('+')
    ? input.slice(1)
    : input.startsWith('00')
    ? input.slice(2)
    : input;

  return /^\d{8,15}$/.test(core);
}

function boundKey(value: string): string {
  if (value.length <= MAX_IDENTITY_KEY_LEN) {
    return value;
  }
  return `${value.slice(0, 64)}:${stableHash(value)}`;
}

function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}
