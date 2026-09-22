/**
 * Authoritative PLP price / sale semantics (PLP-1).
 *
 * REAL SALE exists only when:
 *   price > 0 AND discountedPrice > 0 AND discountedPrice < price
 *
 * Mapper, effective-price sort, and discount sort MUST use this predicate.
 */

export type PlpPriceFields = {
  price: number | null | undefined;
  discountedPrice: number | null | undefined;
  discountPercent?: number | null | undefined;
};

function asFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** True only for a genuine customer-visible sale. */
export function isRealSale(
  price: number | null | undefined,
  discountedPrice: number | null | undefined,
): boolean {
  const list = asFiniteNumber(price);
  const sale = asFiniteNumber(discountedPrice);
  if (list == null || sale == null) return false;
  return list > 0 && sale > 0 && sale < list;
}

/** Customer-facing current price in storage currency (TRY). */
export function effectiveSellPrice(
  price: number | null | undefined,
  discountedPrice: number | null | undefined,
): number {
  const list = asFiniteNumber(price) ?? 0;
  const sale = asFiniteNumber(discountedPrice);
  if (isRealSale(list, sale)) {
    return sale as number;
  }
  return list > 0 ? list : 0;
}

/**
 * Customer-visible discount percent derived from real sale prices.
 * Returns null when not a real sale (ignores stale discountPercent).
 */
export function visibleDiscountPercent(
  price: number | null | undefined,
  discountedPrice: number | null | undefined,
): number | null {
  if (!isRealSale(price, discountedPrice)) return null;
  const list = asFiniteNumber(price) as number;
  const sale = asFiniteNumber(discountedPrice) as number;
  const pct = ((list - sale) / list) * 100;
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return Math.round(pct);
}

/**
 * SQL CASE for effective sell price — must match effectiveSellPrice().
 * Alias as mainPrice for ORDER BY.
 */
export const STOREFRONT_EFFECTIVE_PRICE_SQL = `CASE
  WHEN product.price > 0
   AND product.discountedPrice > 0
   AND product.discountedPrice < product.price
  THEN product.discountedPrice
  ELSE COALESCE(NULLIF(product.price, 0), 0)
END`;

/**
 * SQL CASE for discount ranking — must match visibleDiscountPercent().
 * Non-sales rank as 0.
 */
export const STOREFRONT_VISIBLE_DISCOUNT_SQL = `CASE
  WHEN product.price > 0
   AND product.discountedPrice > 0
   AND product.discountedPrice < product.price
  THEN ((product.price - product.discountedPrice) / product.price) * 100
  ELSE 0
END`;

/**
 * SQL WHERE fragment — genuine current sale only.
 * Must match isRealSale(). Use when discount rails / sort=discount must
 * exclude ended-discount or never-discounted products.
 */
export const STOREFRONT_REAL_SALE_WHERE_SQL = `(
  product.price > 0
  AND product.discountedPrice > 0
  AND product.discountedPrice < product.price
)`;
