/**
 * Customer-facing Order shapes for GET /orders/me and GET /orders/:id/me.
 *
 * Intentionally omits FIN-1 / ops internals (COGS, shippingCostActual,
 * guest tokens, FX source, profitability). Preserves fields the
 * storefront needs for totals, delivery snapshot, payment state,
 * tracking, and ACCOUNT-1A map presence (lat/lng).
 */

export type CustomerOrderItemView = {
  id: number;
  orderId: number;
  productId: number;
  productAttributeValueId: number | null;
  productName: string | null;
  optionName: string | null;
  optionLabel: string | null;
  price: number;
  discountedPrice: number;
  quantity: number;
  finalAmount: number;
  createdAt: Date | string;
  product?: unknown;
  productAttributeValue?: unknown;
};

export type CustomerOrderView = {
  id: number;
  number: string;
  customerId: number | null;
  /** Needed by storefront to derive paymentState / C2A eligibility. */
  successfulTransactionId: number | null;
  amount: number;
  discount: number | null;
  shipping: number;
  tax: number | null;
  finalAmount: number;
  commercialCurrency: 'USD' | 'TRY' | 'IRT' | null;
  firstName: string | null;
  lastName: string | null;
  address: string | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  addressDetails: string | null;
  postalCode: string | null;
  phone: string | null;
  cityId: number | null;
  description: string | null;
  postTrackingCode: string | null;
  sourceTrackingCode: string | null;
  status: string;
  reasonRejected: string | null;
  createdAt: Date | string;
  orderItems?: CustomerOrderItemView[];
  countItems?: number;
};

/** Order-level keys that must never appear in customer responses. */
export const CUSTOMER_ORDER_OMITTED_KEYS = [
  'shippingCostActual',
  'profitabilityStatus',
  'financialConfirmedAt',
  'fxRateSource',
  'fxRateToIrt',
  'fxCapturedAt',
  'guestAccessToken',
  'checkoutIdempotencyKey',
  'isDeleted',
  'successfulTransaction',
  'customer',
  'city',
  'transactions',
  'orderStatuses',
  'walletHistories',
] as const;

/** Order-item COGS / cost keys omitted from customer responses. */
export const CUSTOMER_ORDER_ITEM_OMITTED_KEYS = [
  'unitPurchaseCostSnapshot',
  'unitLandedCostSnapshot',
  'costCurrency',
  'cogsStatus',
  'costSource',
] as const;

function mapOrderItem(item: Record<string, unknown>): CustomerOrderItemView {
  const product =
    item.product && typeof item.product === 'object' ? item.product : undefined;
  const pav =
    item.productAttributeValue && typeof item.productAttributeValue === 'object'
      ? item.productAttributeValue
      : undefined;

  const view: CustomerOrderItemView = {
    id: Number(item.id),
    orderId: Number(item.orderId),
    productId: Number(item.productId),
    productAttributeValueId:
      item.productAttributeValueId == null
        ? null
        : Number(item.productAttributeValueId),
    productName: (item.productName as string | null) ?? null,
    optionName: (item.optionName as string | null) ?? null,
    optionLabel: (item.optionLabel as string | null) ?? null,
    price: Number(item.price) || 0,
    discountedPrice: Number(item.discountedPrice) || 0,
    quantity: Number(item.quantity) || 0,
    finalAmount: Number(item.finalAmount) || 0,
    createdAt: item.createdAt as Date | string,
  };

  if (product) {
    // Keep product relation for storefront name/cover fallback; strip nothing
    // deep beyond what TypeORM already selected for customer getById.
    view.product = product;
  }
  if (pav) {
    view.productAttributeValue = pav;
  }

  return view;
}

/**
 * Map a loaded OrderEntity (or plain row) to a customer-safe response object.
 */
export function toCustomerOrderView(
  order: Record<string, unknown>,
  extras?: { countItems?: number },
): CustomerOrderView {
  const itemsRaw = Array.isArray(order.orderItems) ? order.orderItems : null;

  const view: CustomerOrderView = {
    id: Number(order.id),
    number: String(order.number ?? ''),
    customerId: order.customerId == null ? null : Number(order.customerId),
    successfulTransactionId:
      order.successfulTransactionId == null
        ? null
        : Number(order.successfulTransactionId),
    amount: Number(order.amount) || 0,
    discount: order.discount == null ? null : Number(order.discount),
    shipping: Number(order.shipping) || 0,
    tax: order.tax == null ? null : Number(order.tax),
    finalAmount: Number(order.finalAmount) || 0,
    commercialCurrency:
      (order.commercialCurrency as CustomerOrderView['commercialCurrency']) ??
      null,
    firstName: (order.firstName as string | null) ?? null,
    lastName: (order.lastName as string | null) ?? null,
    address: (order.address as string | null) ?? null,
    location: (order.location as string | null) ?? null,
    latitude: order.latitude == null ? null : Number(order.latitude),
    longitude: order.longitude == null ? null : Number(order.longitude),
    addressDetails: (order.addressDetails as string | null) ?? null,
    postalCode: (order.postalCode as string | null) ?? null,
    phone: (order.phone as string | null) ?? null,
    cityId: order.cityId == null ? null : Number(order.cityId),
    description: (order.description as string | null) ?? null,
    postTrackingCode: (order.postTrackingCode as string | null) ?? null,
    sourceTrackingCode: (order.sourceTrackingCode as string | null) ?? null,
    status: String(order.status ?? 'pending'),
    reasonRejected: (order.reasonRejected as string | null) ?? null,
    createdAt: order.createdAt as Date | string,
  };

  if (itemsRaw) {
    view.orderItems = itemsRaw.map((item) =>
      mapOrderItem(item as Record<string, unknown>),
    );
  }

  if (extras?.countItems != null) {
    view.countItems = extras.countItems;
  }

  return view;
}

/** True if a serialized customer response still contains an omitted key. */
export function customerOrderViewLeaksSensitive(
  view: CustomerOrderView,
): boolean {
  const json = JSON.stringify(view);
  for (const key of CUSTOMER_ORDER_OMITTED_KEYS) {
    if (json.includes(`"${key}"`)) return true;
  }
  for (const key of CUSTOMER_ORDER_ITEM_OMITTED_KEYS) {
    if (json.includes(`"${key}"`)) return true;
  }
  return false;
}
