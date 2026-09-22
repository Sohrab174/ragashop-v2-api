/**
 * Map loaded Product + relations → storefront PDP contract.
 */

import {
  effectiveSellPrice,
  isRealSale,
  visibleDiscountPercent,
} from './storefront-plp.pricing';
import { buildStorefrontPdpGallery } from './storefront-pdp.gallery';
import { buildStorefrontPdpDescription } from './storefront-pdp.description';
import { mapStorefrontPdpAttributesAndOptions } from './storefront-pdp.options';
import { resolveStorefrontPdpAvailability } from './storefront-pdp.availability';
import type {
  StorefrontPdpBreadcrumbItem,
  StorefrontPdpProduct,
  StorefrontPdpSibling,
} from './storefront-pdp.types';

export type RawPdpProduct = {
  id: number;
  name: string;
  price: number | null;
  discountedPrice: number | null;
  quantity: number;
  isSellable?: boolean | null;
  description?: string | null;
  sourceDescription?: string | null;
  color?: string | null;
  colorHex?: string | null;
  cover?: { id?: number | null; pathFile?: string | null } | null;
  brand?: { name?: string | null; sourceName?: string | null } | null;
  productGalleries?: Array<{
    id?: number | null;
    pathFile?: string | null;
    type?: string | null;
  }> | null;
  productDescriptions?: Array<{
    content?: string | null;
    sourceContent?: string | null;
    displayOrder?: number | null;
    isDeleted?: boolean | null;
  }> | null;
  productAttributeValues?: Array<{
    id: number;
    quantity: number;
    price: number | null;
    discountedPrice: number | null;
    attributeValue?: {
      id?: number;
      name?: string | null;
      extraValue?: string | null;
      attributeId?: number;
      attribute?: {
        id?: number;
        name?: string | null;
        type?: string | null;
      } | null;
    } | null;
  }> | null;
};

export type RawPdpSibling = {
  id: number;
  name: string;
  color?: string | null;
  colorHex?: string | null;
  cover?: { pathFile?: string | null } | null;
};

function roundMoney(value: number): number {
  return Math.round(value);
}

export function mapStorefrontPdpSiblings(
  rows: RawPdpSibling[] | null | undefined,
): StorefrontPdpSibling[] {
  const out: StorefrontPdpSibling[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.id) continue;
    const label = row.color ? String(row.color).trim() || null : null;
    const swatch = row.colorHex ? String(row.colorHex).trim() || null : null;
    out.push({
      id: row.id,
      name: String(row.name || '').trim() || `محصول ${row.id}`,
      image: row.cover?.pathFile || null,
      label,
      swatch,
    });
  }
  return out;
}

export function mapStorefrontPdpProduct(
  product: RawPdpProduct,
  tryToToman: number,
  breadcrumb: StorefrontPdpBreadcrumbItem[],
  siblings: RawPdpSibling[] = [],
): StorefrontPdpProduct {
  const listPrice = Number(product.price) || 0;
  const hasSale = isRealSale(product.price, product.discountedPrice);
  const currentTry = effectiveSellPrice(product.price, product.discountedPrice);
  const compareTry = hasSale ? listPrice : null;
  const discount = visibleDiscountPercent(
    product.price,
    product.discountedPrice,
  );

  const brandName = product.brand?.name || product.brand?.sourceName || null;

  const { options, attributes } = mapStorefrontPdpAttributesAndOptions(
    product.productAttributeValues,
    tryToToman,
  );

  const allOptionsUnavailable =
    options.length > 0 &&
    options.every((g) => g.values.every((v) => !v.available));

  const availability = resolveStorefrontPdpAvailability({
    quantity: Number(product.quantity),
    isSellable: product.isSellable,
    hasRequiredOptions: options.length > 0,
    allOptionsUnavailable,
  });

  return {
    id: product.id,
    name: product.name,
    brand: brandName,
    breadcrumb,
    images: buildStorefrontPdpGallery(
      product.cover ?? null,
      product.productGalleries,
    ),
    price: roundMoney(currentTry * tryToToman),
    compareAtPrice:
      compareTry != null ? roundMoney(compareTry * tryToToman) : null,
    discount,
    availability,
    options,
    attributes,
    description: buildStorefrontPdpDescription(
      product.productDescriptions,
      product.description,
      product.sourceDescription,
      attributes,
    ),
    siblings: mapStorefrontPdpSiblings(siblings),
  };
}
