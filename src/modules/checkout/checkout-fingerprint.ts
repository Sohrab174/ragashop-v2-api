import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { toToman } from '../cart/cart-line.resolve';

export type CheckoutFingerprintLine = {
  productId: number;
  productAttributeValueId: number | null;
  quantity: number;
  /** Authoritative unit payable price in source currency (TRY). */
  unitPriceTry: number;
};

export type CheckoutFingerprintInput = {
  cartId: number;
  cartUpdatedAt: string;
  lines: CheckoutFingerprintLine[];
  subtotalTry: number;
  shippingTry: number;
  taxTry: number;
  payableTry: number;
  /**
   * Authoritative TRY→toman rate snapshot used for customer-visible IRT totals.
   * Must match the rate applied when the customer reviewed preview.
   */
  tryToToman: number;
};

/**
 * Stable confirmation token for preview → create.
 * Recomputed on submit; mismatch means cart/price/rate state changed.
 *
 * v2 commits to TRY commercial state AND the conversion rate / displayed IRT
 * totals the customer reviewed.
 */
export function buildCheckoutConfirmationToken(
  input: CheckoutFingerprintInput,
): string {
  const lines = [...input.lines]
    .map((l) => ({
      productId: l.productId,
      productAttributeValueId: l.productAttributeValueId ?? 0,
      quantity: l.quantity,
      unitPriceTry: roundMoney(l.unitPriceTry),
    }))
    .sort((a, b) => {
      if (a.productId !== b.productId) return a.productId - b.productId;
      if (a.productAttributeValueId !== b.productAttributeValueId) {
        return a.productAttributeValueId - b.productAttributeValueId;
      }
      return a.quantity - b.quantity;
    });

  const tryToToman = normalizeTryToTomanRate(input.tryToToman);
  const subtotalTry = roundMoney(input.subtotalTry);
  const shippingTry = roundMoney(input.shippingTry);
  const taxTry = roundMoney(input.taxTry);
  const payableTry = roundMoney(input.payableTry);

  const payload = JSON.stringify({
    v: 2,
    cartId: input.cartId,
    cartUpdatedAt: input.cartUpdatedAt,
    lines,
    subtotalTry,
    shippingTry,
    taxTry,
    payableTry,
    tryToToman,
    // Customer-visible IRT outputs via the same authoritative toToman helper.
    subtotalIrt: toToman(subtotalTry, tryToToman),
    shippingIrt: toToman(shippingTry, tryToToman),
    taxIrt: toToman(taxTry, tryToToman),
    payableIrt: toToman(payableTry, tryToToman),
  });

  return createHash('sha256').update(payload).digest('hex');
}

/** Normalize conversion rate for deterministic fingerprinting. */
export function normalizeTryToTomanRate(rate: number): number {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return 1;
  // Keep enough precision for FX without float noise; same as money rounding scale.
  return roundMoney(n);
}

export type OwnerScopedIdempotencyInput = {
  /** Validated client Idempotency-Key (raw). */
  clientKey: string;
  /** Authenticated customer id, or null for guest. */
  customerId: number | null;
  /**
   * Guest cart session ownership key (from X-Cart-Session / ensureSessionKey).
   * Ignored when customerId is set.
   */
  sessionKey: string | null;
};

/**
 * Owner-scoped idempotency identity stored in order.checkoutIdempotencyKey.
 * SHA-256 hex (64 chars) fits the existing varchar(64) unique column.
 *
 * Raw client keys are NEVER stored or looked up globally.
 */
export function buildOwnerScopedIdempotencyKey(
  input: OwnerScopedIdempotencyInput,
): string {
  const clientKey = String(input.clientKey || '').trim();
  const ownerType =
    input.customerId != null && Number.isFinite(Number(input.customerId))
      ? 'customer'
      : 'guest';
  const ownerId =
    ownerType === 'customer'
      ? String(Math.trunc(Number(input.customerId)))
      : String(input.sessionKey || '').trim();

  // Canonical JSON — field order fixed; no ambiguous concatenation.
  const payload = JSON.stringify({
    v: 1,
    ns: 'ragashop.checkout.idempotency',
    ownerType,
    ownerId,
    clientKey,
  });

  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function confirmationTokensMatch(
  expected: string,
  provided: string,
): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(String(expected), 'utf8');
  const b = Buffer.from(String(provided), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function generateGuestAccessToken(): string {
  return randomBytes(32).toString('hex');
}

export function isValidIdempotencyKey(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const v = raw.trim();
  // UUID or 16–64 hex / url-safe token
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v,
    ) || /^[A-Za-z0-9_-]{16,64}$/.test(v)
  );
}

export function roundMoney(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
