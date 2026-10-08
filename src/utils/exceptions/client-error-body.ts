/**
 * Client-safe projection of object-form HttpException responses.
 *
 * Envelope convention: { success: false, messages: string[], data: { code?, details? } }
 * Only `message`/`messages`, `code` and flat primitive `details` survive; everything
 * else on the thrown object (nested objects, stacks, SQL, internals) is dropped.
 */

export type ClientErrorDetailValue = string | number | boolean | null;

export type ClientErrorData = {
  code?: string;
  details?: Record<string, ClientErrorDetailValue>;
};

const CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/i;
const DETAIL_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/i;
const UNSAFE_DETAIL_KEY = /stack|trace|sql|query|password|secret|token/i;
const MAX_DETAIL_KEYS = 20;
const MAX_STRING_LENGTH = 500;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === 'object' && !Array.isArray(v);

export function sanitizeClientErrorCode(value: unknown): string | null {
  return typeof value === 'string' && CODE_PATTERN.test(value) ? value : null;
}

export function sanitizeClientErrorDetails(
  value: unknown,
): Record<string, ClientErrorDetailValue> | null {
  if (!isPlainObject(value)) return null;
  const out: Record<string, ClientErrorDetailValue> = {};
  let kept = 0;
  for (const [key, raw] of Object.entries(value)) {
    if (kept >= MAX_DETAIL_KEYS) break;
    if (!DETAIL_KEY_PATTERN.test(key) || UNSAFE_DETAIL_KEY.test(key)) continue;
    if (raw === null || typeof raw === 'boolean') {
      out[key] = raw;
    } else if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) continue;
      out[key] = raw;
    } else if (typeof raw === 'string') {
      out[key] = raw.slice(0, MAX_STRING_LENGTH);
    } else {
      continue;
    }
    kept += 1;
  }
  return kept > 0 ? out : null;
}

/** `{ code, details }` when the response carries a valid code; otherwise `{}`. */
export function structuredClientErrorData(response: unknown): ClientErrorData {
  if (!isPlainObject(response)) return {};
  const code = sanitizeClientErrorCode(response.code);
  if (!code) return {};
  const details = sanitizeClientErrorDetails(response.details);
  return details ? { code, details } : { code };
}

export function clientErrorMessages(
  response: unknown,
  fallback = 'Error',
): string[] {
  if (!isPlainObject(response)) return [fallback];
  const pick = (v: unknown): string[] => {
    if (typeof v === 'string' && v) return [v.slice(0, MAX_STRING_LENGTH)];
    if (Array.isArray(v)) {
      return v
        .filter((m): m is string => typeof m === 'string' && !!m)
        .map((m) => m.slice(0, MAX_STRING_LENGTH));
    }
    return [];
  };
  const fromMessage = pick(response.message);
  if (fromMessage.length) return fromMessage;
  const fromMessages = pick(response.messages);
  return fromMessages.length ? fromMessages : [fallback];
}
