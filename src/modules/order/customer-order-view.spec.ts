import {
  CUSTOMER_ORDER_ITEM_OMITTED_KEYS,
  CUSTOMER_ORDER_OMITTED_KEYS,
  customerOrderViewLeaksSensitive,
  toCustomerOrderView,
} from './customer-order-view';

describe('toCustomerOrderView (SHIPPING-1)', () => {
  const baseOrder = {
    id: 42,
    number: '14010142',
    customerId: 7,
    successfulTransactionId: 99,
    amount: 100,
    discount: 0,
    shipping: 5,
    tax: 0,
    finalAmount: 105,
    commercialCurrency: 'TRY',
    shippingCostActual: 12.5,
    profitabilityStatus: 'complete',
    financialConfirmedAt: new Date('2026-01-01T00:00:00.000Z'),
    fxRateSource: 'TGJU',
    fxRateToIrt: 3500,
    fxCapturedAt: new Date('2026-01-01T00:00:00.000Z'),
    guestAccessToken: 'secret-guest-token',
    checkoutIdempotencyKey: 'abc123idempotency',
    isDeleted: false,
    firstName: 'Ali',
    lastName: 'Test',
    address: 'خیابان تست ۱۲',
    location: '35.7,51.4',
    latitude: 35.6892,
    longitude: 51.389,
    addressDetails: 'واحد ۲',
    postalCode: '1234567890',
    phone: '+989121234567',
    cityId: 1,
    description: 'تحویل عصر',
    postTrackingCode: 'POST-1',
    sourceTrackingCode: 'SRC-9',
    status: 'sent',
    reasonRejected: null,
    createdAt: new Date('2026-03-01T12:00:00.000Z'),
    orderItems: [
      {
        id: 1,
        orderId: 42,
        productId: 10,
        productAttributeValueId: null,
        productName: 'کفش',
        optionName: null,
        optionLabel: null,
        price: 100,
        discountedPrice: 100,
        quantity: 1,
        finalAmount: 100,
        unitPurchaseCostSnapshot: 40,
        unitLandedCostSnapshot: 45,
        costCurrency: 'TRY',
        cogsStatus: 'captured',
        costSource: 'import',
        createdAt: new Date('2026-03-01T12:00:00.000Z'),
        product: { id: 10, name: 'کفش' },
      },
    ],
  };

  it('omits shippingCostActual and FIN-1 / ops internals', () => {
    const view = toCustomerOrderView(baseOrder);
    const json = JSON.stringify(view);

    for (const key of CUSTOMER_ORDER_OMITTED_KEYS) {
      expect(json).not.toContain(`"${key}"`);
    }
    for (const key of CUSTOMER_ORDER_ITEM_OMITTED_KEYS) {
      expect(json).not.toContain(`"${key}"`);
    }
    expect(customerOrderViewLeaksSensitive(view)).toBe(false);
    expect((view as any).shippingCostActual).toBeUndefined();
  });

  it('preserves customer-required money, delivery, and tracking fields', () => {
    const view = toCustomerOrderView(baseOrder, { countItems: 1 });

    expect(view.id).toBe(42);
    expect(view.number).toBe('14010142');
    expect(view.status).toBe('sent');
    expect(view.successfulTransactionId).toBe(99);
    expect(view.amount).toBe(100);
    expect(view.shipping).toBe(5);
    expect(view.finalAmount).toBe(105);
    expect(view.commercialCurrency).toBe('TRY');
    expect(view.postalCode).toBe('1234567890');
    expect(view.address).toBe('خیابان تست ۱۲');
    expect(view.cityId).toBe(1);
    expect(view.latitude).toBe(35.6892);
    expect(view.longitude).toBe(51.389);
    expect(view.postTrackingCode).toBe('POST-1');
    expect(view.sourceTrackingCode).toBe('SRC-9');
    expect(view.createdAt).toBeTruthy();
    expect(view.countItems).toBe(1);
    expect(view.orderItems).toHaveLength(1);
    const line = view.orderItems?.[0];
    expect(line).toBeDefined();
    if (!line) {
      throw new Error('expected order line');
    }
    expect(line.productName).toBe('کفش');
    expect(line.finalAmount).toBe(100);
    expect(
      (line as Record<string, unknown>).unitPurchaseCostSnapshot,
    ).toBeUndefined();
  });
});
