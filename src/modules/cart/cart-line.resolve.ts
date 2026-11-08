/**
 * Cart add-item selection validation against authoritative PDP option groups.
 * Does not trust frontend labels or prices.
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
import { isCustomerVisibleProduct } from '../product/product-visibility.util';
import { isFreshExternalCommercialData } from '../source-availability/customer-freshness';
import { buildCartConfigKey } from './cart-config-key';
import {
  CART_MAX_LINE_QUANTITY,
  clampCartQuantityAgainstStock,
  resolveCartStockCeiling,
} from './cart-stock';

export type CartSelectionInput = {
  attributeId: unknown;
  valueId: unknown;
};

export type CartProductSnapshot = {
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
  productAttributeValues?: RawPdpPav[] | null;
  supplyType?: string | null;
  sourceAvailability?: string | null;
  sourceSyncStatus?: string | null;
  availabilityLastConfirmedAt?: Date | string | null;
};

export type ResolvedCartLineConfig = {
  productId: number;
  productAttributeValueId: number | null;
  configKey: string;
  quantity: number;
  selectedOptions: Array<{
    attributeId: number;
    name: string;
    valueId: number;
    label: string;
  }>;
  unitPriceTry: number;
  compareAtPriceTry: number | null;
  discountPercent: number | null;
  maxQuantity: number | null;
};

export type CartLineResolveFailure =
  | { code: 'product_not_found'; message: string }
  | { code: 'not_sellable'; message: string }
  | { code: 'out_of_stock'; message: string }
  | { code: 'missing_option'; message: string }
  | { code: 'invalid_option'; message: string }
  | { code: 'invalid_quantity'; message: string }
  | { code: 'exceeds_stock'; message: string }
  | { code: 'invalid_price'; message: string }
  | { code: 'source_verification_required'; message: string }
  | { code: 'fx_rate_unavailable'; message: string };

function asPositiveInt(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 1 || !Number.isSafeInteger(value)) {
      return null;
    }
    return value;
  }
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!/^[0-9]+$/.test(raw)) return null;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 1) return null;
    return n;
  }
  return null;
}

function normalizeSelections(
  selections: CartSelectionInput[] | null | undefined,
):
  | { ok: true; map: Map<number, number> }
  | { ok: false; failure: CartLineResolveFailure } {
  const list = Array.isArray(selections) ? selections : [];
  const map = new Map<number, number>();

  for (const row of list) {
    if (!row || typeof row !== 'object') {
      return {
        ok: false,
        failure: {
          code: 'invalid_option',
          message: 'این گزینه دیگر موجود نیست',
        },
      };
    }
    const attributeId = asPositiveInt(row.attributeId);
    const valueId = asPositiveInt(row.valueId);
    if (attributeId == null || valueId == null) {
      return {
        ok: false,
        failure: {
          code: 'invalid_option',
          message: 'این گزینه دیگر موجود نیست',
        },
      };
    }
    if (map.has(attributeId) && map.get(attributeId) !== valueId) {
      return {
        ok: false,
        failure: {
          code: 'invalid_option',
          message: 'این گزینه دیگر موجود نیست',
        },
      };
    }
    map.set(attributeId, valueId);
  }

  return { ok: true, map };
}

/**
 * Resolve and validate a cart line against local Product/PAV state.
 * Prices are always derived server-side (TRY storage currency).
 */
export function resolveCartLineConfig(input: {
  product: CartProductSnapshot | null | undefined;
  quantity: unknown;
  selections?: CartSelectionInput[] | null;
  tryToToman?: number;
}):
  | { ok: true; config: ResolvedCartLineConfig }
  | { ok: false; failure: CartLineResolveFailure } {
  const product = input.product;
  if (!product || !isCustomerVisibleProduct(product as any)) {
    return {
      ok: false,
      failure: {
        code: 'product_not_found',
        message: 'محصول ناموجود است',
      },
    };
  }

  if (!isFreshExternalCommercialData(product)) {
    return {
      ok: false,
      failure: {
        code: 'source_verification_required',
        message: 'قیمت و موجودی این کالا باید از فروشنده بررسی شود. لطفاً تازه‌سازی را انجام دهید.',
      },
    };
  }

  const qtyRaw = asPositiveInt(input.quantity);
  if (qtyRaw == null || qtyRaw > CART_MAX_LINE_QUANTITY) {
    return {
      ok: false,
      failure: {
        code: 'invalid_quantity',
        message: 'تعداد انتخابی نامعتبر است',
      },
    };
  }

  const tryToTomanRaw = Number(input.tryToToman);
  if (!Number.isFinite(tryToTomanRaw) || tryToTomanRaw <= 0) {
    return {
      ok: false,
      failure: {
        code: 'fx_rate_unavailable',
        message: 'نرخ ارز معتبر در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.',
      },
    };
  }
  const tryToToman = tryToTomanRaw;

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

  if (!availability.purchasable) {
    return {
      ok: false,
      failure: {
        code: 'not_sellable',
        message: 'محصول ناموجود است',
      },
    };
  }

  const sel = normalizeSelections(input.selections);
  if (sel.ok === false) {
    return { ok: false, failure: sel.failure };
  }

  // Reject unknown attribute keys when product has no required options
  if (options.length === 0) {
    if (sel.map.size > 0) {
      return {
        ok: false,
        failure: {
          code: 'invalid_option',
          message: 'این گزینه دیگر موجود نیست',
        },
      };
    }
  } else {
    const required = options[0];

    // Reject extra / foreign attribute selections first
    for (const attrId of sel.map.keys()) {
      if (attrId !== required.attributeId) {
        return {
          ok: false,
          failure: {
            code: 'invalid_option',
            message: 'این گزینه دیگر موجود نیست',
          },
        };
      }
    }

    const selectedPavId = sel.map.get(required.attributeId);
    if (selectedPavId == null) {
      return {
        ok: false,
        failure: {
          code: 'missing_option',
          message: `لطفاً ${required.name} را انتخاب کنید`,
        },
      };
    }

    const value = required.values.find((v) => v.id === selectedPavId);
    if (!value) {
      return {
        ok: false,
        failure: {
          code: 'invalid_option',
          message: 'این گزینه دیگر موجود نیست',
        },
      };
    }
    if (!value.available) {
      return {
        ok: false,
        failure: {
          code: 'out_of_stock',
          message: 'این گزینه دیگر موجود نیست',
        },
      };
    }

    const belonging = (product.productAttributeValues || []).some(
      (p) => p.id === selectedPavId,
    );
    if (!belonging) {
      return {
        ok: false,
        failure: {
          code: 'invalid_option',
          message: 'این گزینه دیگر موجود نیست',
        },
      };
    }

    const pav = (product.productAttributeValues || []).find(
      (p) => p.id === selectedPavId,
    );

    const stock = resolveCartStockCeiling(Number(pav?.quantity ?? 0));
    const clamped = clampCartQuantityAgainstStock(qtyRaw, stock);
    if (clamped.ok === false) {
      return {
        ok: false,
        failure: {
          code: clamped.reason,
          message:
            clamped.reason === 'exceeds_stock'
              ? 'تعداد انتخابی بیشتر از موجودی است'
              : 'این گزینه دیگر موجود نیست',
        },
      };
    }

    // Price: option own price if present, else product
    const hasOwnPrice =
      pav?.price != null &&
      Number.isFinite(Number(pav.price)) &&
      Number(pav.price) > 0;
    const listTry = hasOwnPrice
      ? Number(pav!.price)
      : Number(product.price) || 0;
    const saleTry = hasOwnPrice
      ? pav!.discountedPrice != null
        ? Number(pav!.discountedPrice)
        : null
      : product.discountedPrice;
    const unitTry = effectiveSellPrice(listTry, saleTry);
    if (!Number.isFinite(unitTry) || unitTry <= 0) {
      return {
        ok: false,
        failure: {
          code: 'invalid_price',
          message: 'محصول ناموجود است',
        },
      };
    }

    return {
      ok: true,
      config: {
        productId: product.id,
        productAttributeValueId: selectedPavId,
        configKey: buildCartConfigKey(product.id, selectedPavId),
        quantity: clamped.quantity,
        selectedOptions: [
          {
            attributeId: required.attributeId,
            name: required.name,
            valueId: selectedPavId,
            label: value.label,
          },
        ],
        unitPriceTry: unitTry,
        compareAtPriceTry: isRealSale(listTry, saleTry) ? listTry : null,
        discountPercent: visibleDiscountPercent(listTry, saleTry),
        maxQuantity: stock.maxQuantity,
      },
    };
  }

  // No required options — product-level stock/price
  if (availability.status === 'out_of_stock') {
    return {
      ok: false,
      failure: {
        code: 'out_of_stock',
        message: 'محصول ناموجود است',
      },
    };
  }

  const stock = resolveCartStockCeiling(Number(product.quantity));
  const clamped = clampCartQuantityAgainstStock(qtyRaw, stock);
  if (clamped.ok === false) {
    return {
      ok: false,
      failure: {
        code: clamped.reason,
        message:
          clamped.reason === 'exceeds_stock'
            ? 'تعداد انتخابی بیشتر از موجودی است'
            : 'محصول ناموجود است',
      },
    };
  }

  const listTry = Number(product.price) || 0;
  const saleTry = product.discountedPrice;
  const unitTry = effectiveSellPrice(listTry, saleTry);
  if (!Number.isFinite(unitTry) || unitTry <= 0) {
    return {
      ok: false,
      failure: {
        code: 'invalid_price',
        message: 'محصول ناموجود است',
      },
    };
  }

  return {
    ok: true,
    config: {
      productId: product.id,
      productAttributeValueId: null,
      configKey: buildCartConfigKey(product.id, null),
      quantity: clamped.quantity,
      selectedOptions: [],
      unitPriceTry: unitTry,
      compareAtPriceTry: isRealSale(listTry, saleTry) ? listTry : null,
      discountPercent: visibleDiscountPercent(listTry, saleTry),
      maxQuantity: stock.maxQuantity,
    },
  };
}

export function toToman(amountTry: number, tryToToman: number): number {
  const rate = Number(tryToToman);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('fx_rate_unavailable');
  }
  return Math.round(Number(amountTry) * rate);
}
