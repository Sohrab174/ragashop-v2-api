/**
 * PDP visibility + purchasability helpers.
 *
 * VISIBLE (load PDP): same core predicates as PLP listing eligibility
 * (without canonical category scope — product is addressed by id).
 *
 * PURCHASABLE: visible product that can be bought after valid option selection.
 */

export type PdpStockInput = {
  quantity: number;
  isSellable?: boolean | null;
  /** True when every purchasable option value is quantity === 0 */
  allOptionsUnavailable?: boolean;
  /** True when product has at least one required option group */
  hasRequiredOptions?: boolean;
};

export type PdpAvailabilityStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

/** Finite stock threshold for «تنها چند عدد باقی مانده». */
export const STOREFRONT_PDP_LOW_STOCK_THRESHOLD = 5;

export function isProductQuantityAvailable(quantity: number): boolean {
  return quantity !== 0;
}

/**
 * Product-level availability before a specific option is chosen.
 * When required options exist, product is out_of_stock only if ALL options are unavailable.
 */
export function resolveStorefrontPdpAvailability(input: PdpStockInput): {
  status: PdpAvailabilityStatus;
  purchasable: boolean;
  quantity: number | null;
} {
  const qty = Number(input.quantity);
  const sellable = input.isSellable !== false;

  if (input.hasRequiredOptions) {
    if (input.allOptionsUnavailable) {
      return { status: 'out_of_stock', purchasable: false, quantity: 0 };
    }
    // Option-level stock is authoritative once selected; surface product as in stock
    // when at least one option remains.
    return {
      status: 'in_stock',
      purchasable: sellable,
      quantity: null,
    };
  }

  if (!isProductQuantityAvailable(qty)) {
    return { status: 'out_of_stock', purchasable: false, quantity: 0 };
  }

  if (qty === -1) {
    return {
      status: 'in_stock',
      purchasable: sellable,
      quantity: null,
    };
  }

  if (qty > 0 && qty <= STOREFRONT_PDP_LOW_STOCK_THRESHOLD) {
    return {
      status: 'low_stock',
      purchasable: sellable,
      quantity: qty,
    };
  }

  return {
    status: 'in_stock',
    purchasable: sellable,
    quantity: qty > 0 ? qty : null,
  };
}
