/**
 * Resolve cart lines into checkout-ready commercial rows.
 * Reuses cart availability/price semantics; fails closed (no partial orders).
 */

import {
  mapStorefrontPdpAttributesAndOptions,
  type RawPdpPav,
} from '../catalog/storefront-pdp.options';
import { resolveStorefrontPdpAvailability } from '../catalog/storefront-pdp.availability';
import {
  effectiveSellPrice,
  isRealSale,
} from '../catalog/storefront-plp.pricing';
import { isCustomerVisibleProduct } from '../product/product-visibility.util';
import { resolveCartStockCeiling } from '../cart/cart-stock';
import { toToman } from '../cart/cart-line.resolve';
import { roundMoney } from './checkout-fingerprint';
import {
  AssortmentCommerceCode,
  evaluateAssortmentCommerceGate,
} from '../catalog/assortment-policy/assortment-enforcement';

export type CheckoutLineIssueCode =
  | 'unavailable'
  | 'invalid_config'
  | 'insufficient_stock'
  | 'invalid_price';

export type CheckoutLineIssue = {
  cartItemId: number;
  productId: number;
  code: CheckoutLineIssueCode;
  message: string;
  /** SCOPE-5/6 — set when the line is blocked by assortment policy. */
  assortmentCode?: AssortmentCommerceCode;
};

export type CheckoutResolvedLine = {
  cartItemId: number;
  productId: number;
  productAttributeValueId: number | null;
  productName: string;
  optionName: string | null;
  optionLabel: string | null;
  quantity: number;
  /** List price TRY */
  priceTry: number;
  /** Discounted/sale price TRY (0 if none) */
  discountedPriceTry: number;
  /** Payable unit TRY */
  unitPriceTry: number;
  lineTotalTry: number;
  image: string | null;
  selectedOptions: Array<{
    attributeId: number;
    name: string;
    valueId: number;
    label: string;
  }>;
};

export type CheckoutProductRow = {
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
  purchaseCost?: number | null;
  landedUnitCost?: number | null;
  costCurrency?: string | null;
  costSource?: string | null;
  productAttributeValues?: any[] | null;
};

export type CheckoutCartItemRow = {
  id: number;
  productId: number;
  productAttributeValueId: number | null;
  quantity: number;
};

export function resolveCheckoutLines(input: {
  items: CheckoutCartItemRow[];
  productsById: Map<number, CheckoutProductRow>;
  /**
   * SCOPE-5/6 — when provided (commerce enforcement on), non-IN categories
   * block the line server-side. Missing entry ⇒ unresolved ⇒ blocked.
   */
  assortmentStatusByCategoryId?: Map<number, string> | null;
}):
  | { ok: true; lines: CheckoutResolvedLine[] }
  | { ok: false; issues: CheckoutLineIssue[] } {
  const lines: CheckoutResolvedLine[] = [];
  const issues: CheckoutLineIssue[] = [];

  for (const item of input.items) {
    const product = input.productsById.get(item.productId);
    if (input.assortmentStatusByCategoryId && product) {
      const status =
        product.categoryId != null
          ? input.assortmentStatusByCategoryId.get(Number(product.categoryId))
          : undefined;
      const gate = evaluateAssortmentCommerceGate(status);
      if (!gate.purchasable) {
        issues.push({
          cartItemId: item.id,
          productId: item.productId,
          code: 'unavailable',
          message: gate.customerMessage,
          assortmentCode: gate.code,
        });
        continue;
      }
    }
    const resolved = resolveOne(item, product);
    if (resolved.ok === false) {
      issues.push(resolved.issue);
    } else {
      lines.push(resolved.line);
    }
  }

  if (issues.length) {
    return { ok: false, issues };
  }
  if (!lines.length) {
    return {
      ok: false,
      issues: [
        {
          cartItemId: 0,
          productId: 0,
          code: 'unavailable',
          message: 'سبد خرید خالی است',
        },
      ],
    };
  }
  return { ok: true, lines };
}

function resolveOne(
  item: CheckoutCartItemRow,
  product: CheckoutProductRow | undefined,
):
  | { ok: true; line: CheckoutResolvedLine }
  | { ok: false; issue: CheckoutLineIssue } {
  const fail = (
    code: CheckoutLineIssueCode,
    message: string,
  ): { ok: false; issue: CheckoutLineIssue } => ({
    ok: false,
    issue: {
      cartItemId: item.id,
      productId: item.productId,
      code,
      message,
    },
  });

  if (!product || !isCustomerVisibleProduct(product as any)) {
    return fail('unavailable', 'این محصول دیگر در دسترس نیست');
  }

  const { options } = mapStorefrontPdpAttributesAndOptions(
    product.productAttributeValues,
    1,
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

  // Product-level sellability wins over any stocked variant.
  if (product.isSellable === false) {
    return fail('unavailable', 'محصول ناموجود است');
  }

  let optionName: string | null = null;
  let optionLabel: string | null = null;
  let selectedOptions: CheckoutResolvedLine['selectedOptions'] = [];
  let listTry = 0;
  let saleTry: number | null = null;
  let pavId: number | null = null;

  if (options.length > 0) {
    const required = options[0];
    pavId = item.productAttributeValueId;
    if (pavId == null) {
      return fail('invalid_config', 'لطفاً گزینه موردنظر را انتخاب کنید');
    }
    const value = required.values.find((v) => v.id === pavId);
    const pav = (product.productAttributeValues || []).find(
      (p) => p.id === pavId,
    );
    if (!value || !pav) {
      return fail('invalid_config', 'این گزینه دیگر موجود نیست');
    }
    const stock = resolveCartStockCeiling(Number(pav.quantity));
    if (!stock.available || !value.available) {
      return fail('unavailable', 'این گزینه دیگر موجود نیست');
    }
    if (stock.maxQuantity != null && item.quantity > stock.maxQuantity) {
      return fail('insufficient_stock', 'تعداد انتخابی بیشتر از موجودی است');
    }

    optionName = required.name;
    optionLabel = value.label;
    selectedOptions = [
      {
        attributeId: required.attributeId,
        name: required.name,
        valueId: pavId,
        label: value.label,
      },
    ];

    const hasOwnPrice =
      pav.price != null &&
      Number.isFinite(Number(pav.price)) &&
      Number(pav.price) > 0;
    listTry = hasOwnPrice ? Number(pav.price) : Number(product.price) || 0;
    saleTry = hasOwnPrice
      ? pav.discountedPrice != null
        ? Number(pav.discountedPrice)
        : null
      : product.discountedPrice;
  } else if (item.productAttributeValueId != null) {
    return fail('invalid_config', 'این گزینه دیگر موجود نیست');
  } else if (
    !availability.purchasable ||
    availability.status === 'out_of_stock'
  ) {
    return fail('unavailable', 'محصول ناموجود است');
  } else {
    const stock = resolveCartStockCeiling(Number(product.quantity));
    if (!stock.available) {
      return fail('unavailable', 'محصول ناموجود است');
    }
    if (stock.maxQuantity != null && item.quantity > stock.maxQuantity) {
      return fail('insufficient_stock', 'تعداد انتخابی بیشتر از موجودی است');
    }
    listTry = Number(product.price) || 0;
    saleTry = product.discountedPrice;
  }

  const unitTry = effectiveSellPrice(listTry, saleTry);
  if (!Number.isFinite(unitTry) || unitTry <= 0) {
    return fail('invalid_price', 'محصول ناموجود است');
  }

  const discountedPriceTry = isRealSale(listTry, saleTry)
    ? roundMoney(Number(saleTry))
    : 0;

  return {
    ok: true,
    line: {
      cartItemId: item.id,
      productId: product.id,
      productAttributeValueId: pavId,
      productName: String(product.name || `محصول ${product.id}`),
      optionName,
      optionLabel,
      quantity: item.quantity,
      priceTry: roundMoney(listTry),
      discountedPriceTry,
      unitPriceTry: roundMoney(unitTry),
      lineTotalTry: roundMoney(unitTry * item.quantity),
      image: product.coverPath || null,
      selectedOptions,
    },
  };
}

export function mapLinesToStorefrontDisplay(
  lines: CheckoutResolvedLine[],
  tryToToman: number,
) {
  return lines.map((line) => ({
    cartItemId: line.cartItemId,
    productId: line.productId,
    name: line.productName,
    image: line.image,
    selectedOptions: line.selectedOptions,
    quantity: line.quantity,
    unitPrice: toToman(line.unitPriceTry, tryToToman),
    lineTotal: toToman(line.lineTotalTry, tryToToman),
  }));
}
