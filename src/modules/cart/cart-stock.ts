/**
 * Pure cart quantity / stock helpers (unit-tested).
 */

/** Safety ceiling for a single cart line (not stock-derived). */
export const CART_MAX_LINE_QUANTITY = 99;

export type CartStockCeiling = {
  /** null = unlimited (-1 semantics) */
  maxQuantity: number | null;
  available: boolean;
};

export function resolveCartStockCeiling(quantity: number): CartStockCeiling {
  const qty = Number(quantity);
  if (!Number.isFinite(qty)) {
    return { maxQuantity: 0, available: false };
  }
  if (qty === -1) {
    return { maxQuantity: null, available: true };
  }
  if (qty <= 0) {
    return { maxQuantity: 0, available: false };
  }
  return {
    maxQuantity: Math.min(qty, CART_MAX_LINE_QUANTITY),
    available: true,
  };
}

export function clampCartQuantityAgainstStock(
  requested: number,
  stockCeiling: CartStockCeiling,
):
  | { ok: true; quantity: number }
  | { ok: false; reason: 'out_of_stock' | 'exceeds_stock' } {
  if (!stockCeiling.available) {
    return { ok: false, reason: 'out_of_stock' };
  }
  if (stockCeiling.maxQuantity == null) {
    if (requested > CART_MAX_LINE_QUANTITY) {
      return { ok: false, reason: 'exceeds_stock' };
    }
    return { ok: true, quantity: requested };
  }
  if (stockCeiling.maxQuantity < 1) {
    return { ok: false, reason: 'out_of_stock' };
  }
  if (requested > stockCeiling.maxQuantity) {
    return { ok: false, reason: 'exceeds_stock' };
  }
  return { ok: true, quantity: requested };
}

export function isValidCartSessionKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const raw = value.trim();
  // UUID v4-ish or 32–64 hex chars
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      raw,
    )
  ) {
    return true;
  }
  if (/^[0-9a-f]{32,64}$/i.test(raw)) {
    return true;
  }
  return false;
}
