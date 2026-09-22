import { roundMoney } from './checkout-fingerprint';

export type CheckoutTotalsSettings = {
  shippingPercent: number | null | undefined;
  maxShippingCost: number | null | undefined;
  taxPercent: number | null | undefined;
};

/**
 * Authoritative order money math — mirrors OrderService.addUpdate.
 * Shipping comes from settings (shippingPercent / maxShippingCost).
 * Does not invent free shipping; zero only when settings yield zero.
 */
export function computeCheckoutTotals(
  itemsAmountTry: number,
  settings: CheckoutTotalsSettings,
): {
  shippingTry: number;
  taxTry: number;
  payableTry: number;
  shippingStatus: 'calculated';
} {
  const items = roundMoney(Math.max(0, Number(itemsAmountTry) || 0));

  let shipping = 0;
  if (settings.shippingPercent) {
    shipping = (Number(settings.shippingPercent) * items) / 100;
    if (
      settings.maxShippingCost &&
      shipping > Number(settings.maxShippingCost)
    ) {
      shipping = Number(settings.maxShippingCost);
    }
  }
  shipping = roundMoney(shipping);

  let tax = 0;
  if (settings.taxPercent) {
    tax = (Number(settings.taxPercent) * items) / 100;
  }
  tax = roundMoney(tax);

  return {
    shippingTry: shipping,
    taxTry: tax,
    payableTry: roundMoney(items + shipping + tax),
    shippingStatus: 'calculated',
  };
}
