/**
 * Uncurated external products stay reachable (paste-link PDP) and are not
 * purchasable until an admin promotes catalog membership.
 * Native products and already-curated external products are unchanged.
 */
export const UNCURATED_EXTERNAL_PURCHASE_MESSAGE =
  'امکان خرید و ارسال این کالا نیاز به بررسی دارد.';

export function isUncuratedExternalPurchase(product: {
  supplyType?: string | null;
  isCuratedExternalCatalog?: boolean | number | null;
} | null | undefined): boolean {
  if (!product || product.supplyType !== 'external_source') return false;
  return (
    product.isCuratedExternalCatalog !== true &&
    Number(product.isCuratedExternalCatalog) !== 1
  );
}
