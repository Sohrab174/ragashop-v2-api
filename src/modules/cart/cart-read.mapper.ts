/**
 * Map persisted cart rows + live product snapshots → storefront cart DTO.
 * Prices are always live (no cart price snapshot in Cart-1).
 */

import {
  mapStorefrontPdpAttributesAndOptions,
  type RawPdpPav,
} from '../catalog/storefront-pdp.options';
import { resolveStorefrontPdpAvailability } from '../catalog/storefront-pdp.availability';
import {
  effectiveSellPrice,
  isRealSale,
  visibleDiscountPercent,
} from '../catalog/storefront-plp.pricing';
import { isUsableGalleryPath } from '../catalog/storefront-pdp.gallery';
import { ProductGalleryType } from '../product/entities/product-gallery.entity';
import { isCustomerVisibleProduct } from '../product/product-visibility.util';
import { toToman } from './cart-line.resolve';
import { CART_MAX_LINE_QUANTITY, resolveCartStockCeiling } from './cart-stock';

export type StorefrontCartSelectedOption = {
  attributeId: number;
  name: string;
  valueId: number;
  label: string;
};

export type StorefrontCartLine = {
  id: number;
  productId: number;
  name: string;
  image: string | null;
  selectedOptions: StorefrontCartSelectedOption[];
  quantity: number;
  unitPrice: number;
  compareAtPrice: number | null;
  discount: number | null;
  lineTotal: number;
  available: boolean;
  maxQuantity: number | null;
  availabilityNote: string | null;
};

export type StorefrontCartResponse = {
  sessionKey: string | null;
  itemCount: number;
  subtotal: number;
  items: StorefrontCartLine[];
};

export type CartReadProductRow = {
  id: number;
  name: string;
  price: number | null;
  discountedPrice: number | null;
  quantity: number;
  isSellable?: boolean | null;
  isDeleted?: boolean;
  status?: string;
  categoryId?: number;
  coverPath?: string | null;
  supplyType?: string | null;
  isCuratedExternalCatalog?: boolean | number | null;
  productAttributeValues?: RawPdpPav[] | null;
};

export type CartReadItemRow = {
  id: number;
  productId: number;
  productAttributeValueId: number | null;
  quantity: number;
};

function uiMaxQuantity(stockMax: number | null): number {
  if (stockMax == null) return CART_MAX_LINE_QUANTITY;
  return Math.min(Math.max(0, stockMax), CART_MAX_LINE_QUANTITY);
}

type CartProductImageSource = {
  cover?: { pathFile?: string | null } | null;
  productGalleries?: Array<{
    pathFile?: string | null;
    type?: string | null;
  }> | null;
};

/**
 * Prefer product cover; if missing/unusable, fall back to the first photo gallery.
 * Variant (size) rows do not carry their own image — cover is the cart thumb.
 */
export function resolveCartProductImagePath(
  product: CartProductImageSource | null | undefined,
): string | null {
  if (!product) return null;
  const cover = product.cover?.pathFile;
  if (isUsableGalleryPath(cover)) return String(cover).trim();

  const galleries = Array.isArray(product.productGalleries)
    ? product.productGalleries
    : [];
  for (const row of galleries) {
    if (row?.type && row.type !== ProductGalleryType.photo) continue;
    if (isUsableGalleryPath(row?.pathFile)) {
      return String(row.pathFile).trim();
    }
  }
  return null;
}

export function mapStorefrontCartResponse(input: {
  sessionKey: string | null;
  items: CartReadItemRow[];
  productsById: Map<number, CartReadProductRow>;
  tryToToman: number;
}): StorefrontCartResponse {
  const lines: StorefrontCartLine[] = [];

  for (const item of input.items) {
    const product = input.productsById.get(item.productId);
    lines.push(mapOneCartLine(item, product, input.tryToToman));
  }

  const purchasable = lines.filter((l) => l.available);
  return {
    sessionKey: input.sessionKey,
    itemCount: purchasable.reduce((sum, l) => sum + l.quantity, 0),
    subtotal: purchasable.reduce((sum, l) => sum + l.lineTotal, 0),
    items: lines,
  };
}

function mapOneCartLine(
  item: CartReadItemRow,
  product: CartReadProductRow | undefined,
  tryToToman: number,
): StorefrontCartLine {
  const fallbackName = product?.name
    ? String(product.name)
    : `محصول ${item.productId}`;

  if (!product || !isCustomerVisibleProduct(product as any)) {
    return {
      id: item.id,
      productId: item.productId,
      name: fallbackName,
      image: product?.coverPath || null,
      selectedOptions: [],
      quantity: item.quantity,
      unitPrice: 0,
      compareAtPrice: null,
      discount: null,
      lineTotal: 0,
      available: false,
      maxQuantity: 0,
      availabilityNote: 'این محصول دیگر در دسترس نیست',
    };
  }

  const { options } = mapStorefrontPdpAttributesAndOptions(
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

  let selectedOptions: StorefrontCartSelectedOption[] = [];
  let unitTry = 0;
  let compareTry: number | null = null;
  let discount: number | null = null;
  let maxQuantity = 0;
  let available = true;
  let availabilityNote: string | null = null;

  if (options.length > 0) {
    const required = options[0];
    const pavId = item.productAttributeValueId;
    if (pavId == null) {
      available = false;
      availabilityNote = 'لطفاً گزینه موردنظر را انتخاب کنید';
    } else {
      const value = required.values.find((v) => v.id === pavId);
      const pav = (product.productAttributeValues || []).find(
        (p) => p.id === pavId,
      );
      if (!value || !pav) {
        available = false;
        availabilityNote = 'این گزینه دیگر موجود نیست';
      } else {
        selectedOptions = [
          {
            attributeId: required.attributeId,
            name: required.name,
            valueId: pavId,
            label: value.label,
          },
        ];
        const stock = resolveCartStockCeiling(Number(pav.quantity));
        maxQuantity = uiMaxQuantity(stock.maxQuantity);
        if (!stock.available || !value.available) {
          available = false;
          availabilityNote = 'این گزینه دیگر موجود نیست';
          maxQuantity = 0;
        } else if (
          stock.maxQuantity != null &&
          item.quantity > stock.maxQuantity
        ) {
          available = false;
          availabilityNote = 'تعداد انتخابی بیشتر از موجودی است';
        }

        const hasOwnPrice =
          pav.price != null &&
          Number.isFinite(Number(pav.price)) &&
          Number(pav.price) > 0;
        const listTry = hasOwnPrice
          ? Number(pav.price)
          : Number(product.price) || 0;
        const saleTry = hasOwnPrice
          ? pav.discountedPrice != null
            ? Number(pav.discountedPrice)
            : null
          : product.discountedPrice;
        unitTry = effectiveSellPrice(listTry, saleTry);
        compareTry = isRealSale(listTry, saleTry) ? listTry : null;
        discount = visibleDiscountPercent(listTry, saleTry);
      }
    }
  } else if (item.productAttributeValueId != null) {
    available = false;
    availabilityNote = 'این گزینه دیگر موجود نیست';
  } else if (
    !availability.purchasable ||
    availability.status === 'out_of_stock'
  ) {
    available = false;
    availabilityNote = 'محصول ناموجود است';
  } else {
    const stock = resolveCartStockCeiling(Number(product.quantity));
    maxQuantity = uiMaxQuantity(stock.maxQuantity);
    if (!stock.available) {
      available = false;
      availabilityNote = 'محصول ناموجود است';
      maxQuantity = 0;
    } else if (stock.maxQuantity != null && item.quantity > stock.maxQuantity) {
      available = false;
      availabilityNote = 'تعداد انتخابی بیشتر از موجودی است';
    }
    const listTry = Number(product.price) || 0;
    unitTry = effectiveSellPrice(listTry, product.discountedPrice);
    compareTry = isRealSale(listTry, product.discountedPrice) ? listTry : null;
    discount = visibleDiscountPercent(listTry, product.discountedPrice);
  }

  if (available && (!Number.isFinite(unitTry) || unitTry <= 0)) {
    available = false;
    availabilityNote = 'محصول ناموجود است';
    maxQuantity = 0;
  }

  const unitPrice = available ? toToman(unitTry, tryToToman) : 0;
  const compareAtPrice =
    available && compareTry != null ? toToman(compareTry, tryToToman) : null;

  return {
    id: item.id,
    productId: item.productId,
    name: String(product.name || fallbackName),
    image: product.coverPath || null,
    selectedOptions,
    quantity: item.quantity,
    unitPrice,
    compareAtPrice,
    discount: available ? discount : null,
    lineTotal: available ? Math.round(unitPrice * item.quantity) : 0,
    available,
    maxQuantity: available ? maxQuantity : 0,
    availabilityNote,
  };
}
