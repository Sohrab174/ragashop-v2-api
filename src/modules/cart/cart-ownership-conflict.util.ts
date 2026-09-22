import { isMysqlDuplicateKeyError } from '../order/utils/duplicate-key.util';

/** Unique indexes that identify Cart ownership (guest session / customer). */
const CART_OWNERSHIP_UNIQUE_KEYS = [
  'uq_cart_sessionKey',
  'uq_cart_customerId',
] as const;

function duplicateMessage(err: any): string {
  const nested = err?.driverError;
  return String(
    err?.sqlMessage ||
      nested?.sqlMessage ||
      err?.message ||
      nested?.message ||
      '',
  );
}

/**
 * True only when a MySQL/MariaDB duplicate-key error conflicts on Cart
 * ownership uniqueness — not cart_item config uniqueness or other tables.
 */
export function isCartOwnershipUniqueViolation(err: unknown): boolean {
  const e = err as any;
  if (
    !isMysqlDuplicateKeyError(e) &&
    !isMysqlDuplicateKeyError(e?.driverError)
  ) {
    return false;
  }
  const msg = duplicateMessage(e);
  return CART_OWNERSHIP_UNIQUE_KEYS.some((key) => msg.includes(key));
}

/** Bound for first-Cart ownership race recovery (fresh transaction). */
export const CART_OWNERSHIP_ADD_MAX_ATTEMPTS = 2;

/**
 * Run `fn`; if it fails solely due to Cart ownership unique race, retry once
 * with a fresh call (caller must start a new DB transaction inside `fn`).
 */
export async function withCartOwnershipConflictRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = CART_OWNERSHIP_ADD_MAX_ATTEMPTS,
): Promise<T> {
  const attempts = Math.max(
    1,
    Math.min(maxAttempts, CART_OWNERSHIP_ADD_MAX_ATTEMPTS),
  );
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts && isCartOwnershipUniqueViolation(err)) {
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
