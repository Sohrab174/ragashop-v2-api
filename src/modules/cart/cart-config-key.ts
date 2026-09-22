/**
 * Cart line configuration identity.
 *
 * Matches existing order/PDP commerce contract:
 * productId + optional productAttributeValueId (PAV primary key).
 * Same product with different PAV → different lines.
 */

export function buildCartConfigKey(
  productId: number,
  productAttributeValueId: number | null | undefined,
): string {
  const pav =
    productAttributeValueId == null || productAttributeValueId === 0
      ? 0
      : productAttributeValueId;
  return `${productId}:${pav}`;
}

export function parseCartConfigKey(configKey: string): {
  productId: number;
  productAttributeValueId: number | null;
} | null {
  const match = /^(\d+):(\d+)$/.exec(String(configKey || '').trim());
  if (!match) return null;
  const productId = Number(match[1]);
  const pavRaw = Number(match[2]);
  if (!Number.isSafeInteger(productId) || productId < 1) return null;
  if (!Number.isSafeInteger(pavRaw) || pavRaw < 0) return null;
  return {
    productId,
    productAttributeValueId: pavRaw === 0 ? null : pavRaw,
  };
}
