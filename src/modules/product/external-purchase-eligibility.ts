import { ProductCatalogOrigin } from '../catalog-lifecycle/catalog-lifecycle.types';

/**
 * External purchase gate (separate from curated showcase discovery).
 *
 * Purchasable external products:
 * - curated showcase members, OR
 * - customer paste-link imports stamped with catalogOrigin=external_on_demand
 *
 * Historical uncurated rows without paste-link provenance stay blocked.
 * Native / unclassified products are unchanged.
 *
 * Freshness, stock, assortment and availability remain enforced elsewhere.
 */
export const UNCURATED_EXTERNAL_PURCHASE_MESSAGE =
  'امکان خرید و ارسال این کالا نیاز به بررسی دارد.';

export function isCustomerPasteImportAuthorized(product: {
  catalogOrigin?: string | null;
} | null | undefined): boolean {
  return product?.catalogOrigin === ProductCatalogOrigin.external_on_demand;
}

export function isUncuratedExternalPurchase(product: {
  supplyType?: string | null;
  isCuratedExternalCatalog?: boolean | number | null;
  catalogOrigin?: string | null;
} | null | undefined): boolean {
  if (!product || product.supplyType !== 'external_source') return false;
  const curated =
    product.isCuratedExternalCatalog === true ||
    Number(product.isCuratedExternalCatalog) === 1;
  if (curated) return false;
  if (isCustomerPasteImportAuthorized(product)) return false;
  return true;
}
