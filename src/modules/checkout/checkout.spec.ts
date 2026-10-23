import {
  buildCheckoutConfirmationToken,
  buildOwnerScopedIdempotencyKey,
  confirmationTokensMatch,
  isValidIdempotencyKey,
  roundMoney,
} from './checkout-fingerprint';
import { computeCheckoutTotals } from './checkout-totals';
import { normalizeCheckoutPhone, isValidCheckoutPhone } from './checkout-phone';
import { resolveCheckoutLines } from './checkout-line.resolve';
import { toToman } from '../cart/cart-line.resolve';

describe('checkout-fingerprint', () => {
  const baseInput = {
    cartId: 10,
    cartUpdatedAt: '2026-01-01T00:00:00.000Z',
    lines: [
      {
        productId: 2,
        productAttributeValueId: 5,
        quantity: 1,
        unitPriceTry: 100,
      },
      {
        productId: 1,
        productAttributeValueId: null,
        quantity: 2,
        unitPriceTry: 50.5,
      },
    ],
    subtotalTry: 201,
    shippingTry: 10,
    taxTry: 0,
    payableTry: 211,
    tryToToman: 1000,
  };

  it('is stable for same commercial state', () => {
    const a = buildCheckoutConfirmationToken(baseInput);
    const b = buildCheckoutConfirmationToken({
      ...baseInput,
      lines: [...baseInput.lines].reverse(),
    });
    expect(a).toBe(b);
    expect(confirmationTokensMatch(a, b)).toBe(true);
  });

  it('changes when unit price changes', () => {
    const a = buildCheckoutConfirmationToken(baseInput);
    const b = buildCheckoutConfirmationToken({
      ...baseInput,
      lines: [{ ...baseInput.lines[0], unitPriceTry: 120 }, baseInput.lines[1]],
      subtotalTry: 221,
      payableTry: 231,
    });
    expect(a).not.toBe(b);
  });

  it('changes when only tryToToman rate changes (IRT display shifts)', () => {
    const a = buildCheckoutConfirmationToken(baseInput);
    const b = buildCheckoutConfirmationToken({
      ...baseInput,
      tryToToman: 2000,
    });
    expect(a).not.toBe(b);
    expect(toToman(baseInput.payableTry, 1000)).not.toBe(
      toToman(baseInput.payableTry, 2000),
    );
  });

  it('validates idempotency keys', () => {
    expect(isValidIdempotencyKey('550e8400-e29b-41d4-a716-446655440000')).toBe(
      true,
    );
    expect(isValidIdempotencyKey('abcdefghijklmnop')).toBe(true);
    expect(isValidIdempotencyKey('short')).toBe(false);
    expect(isValidIdempotencyKey('')).toBe(false);
  });
});

describe('owner-scoped idempotency key', () => {
  const clientKey = '550e8400-e29b-41d4-a716-446655440000';

  it('is stable for same owner + same client key', () => {
    const a = buildOwnerScopedIdempotencyKey({
      clientKey,
      customerId: null,
      sessionKey: 'guest-sess-a',
    });
    const b = buildOwnerScopedIdempotencyKey({
      clientKey,
      customerId: null,
      sessionKey: 'guest-sess-a',
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('isolates different guests with the same raw client key', () => {
    const a = buildOwnerScopedIdempotencyKey({
      clientKey,
      customerId: null,
      sessionKey: 'guest-sess-a',
    });
    const b = buildOwnerScopedIdempotencyKey({
      clientKey,
      customerId: null,
      sessionKey: 'guest-sess-b',
    });
    expect(a).not.toBe(b);
  });

  it('isolates different customers with the same raw client key', () => {
    const a = buildOwnerScopedIdempotencyKey({
      clientKey,
      customerId: 10,
      sessionKey: null,
    });
    const b = buildOwnerScopedIdempotencyKey({
      clientKey,
      customerId: 20,
      sessionKey: null,
    });
    expect(a).not.toBe(b);
  });

  it('does not treat guest session as customer identity', () => {
    const guest = buildOwnerScopedIdempotencyKey({
      clientKey,
      customerId: null,
      sessionKey: '10',
    });
    const customer = buildOwnerScopedIdempotencyKey({
      clientKey,
      customerId: 10,
      sessionKey: null,
    });
    expect(guest).not.toBe(customer);
  });
});

describe('checkout-totals', () => {
  it('applies shippingPercent and cap from settings', () => {
    const totals = computeCheckoutTotals(1000, {
      shippingPercent: 5,
      maxShippingCost: 30,
      taxPercent: 0,
    });
    expect(totals.shippingTry).toBe(30);
    expect(totals.payableTry).toBe(1030);
    expect(totals.shippingStatus).toBe('calculated');
  });

  it('does not invent free shipping when percent is unset', () => {
    const totals = computeCheckoutTotals(1000, {
      shippingPercent: 0,
      maxShippingCost: 0,
      taxPercent: 0,
    });
    expect(totals.shippingTry).toBe(0);
  });

  it('applies uncapped percent when maxShippingCost is 0 (no-cap semantics)', () => {
    const totals = computeCheckoutTotals(1000, {
      shippingPercent: 5,
      maxShippingCost: 0,
      taxPercent: 0,
    });
    // 5% of 1000 = 50; max 0 is falsy → no cap in TRY
    expect(totals.shippingTry).toBe(50);
    expect(totals.payableTry).toBe(1050);
  });

  it('caps shipping in TRY units without inventing flat fee', () => {
    const totals = computeCheckoutTotals(200, {
      shippingPercent: 10,
      maxShippingCost: 15,
      taxPercent: 0,
    });
    // 10% of 200 = 20, capped at 15 TRY
    expect(totals.shippingTry).toBe(15);
  });
});

describe('checkout-phone', () => {
  it('normalizes Iranian mobile to E.164-ish', () => {
    const n = normalizeCheckoutPhone('09121234567');
    expect(isValidCheckoutPhone(n)).toBe(true);
    expect(n?.startsWith('+')).toBe(true);
  });

  it('rejects malformed phone', () => {
    expect(isValidCheckoutPhone(normalizeCheckoutPhone('123'))).toBe(false);
  });
});

describe('resolveCheckoutLines', () => {
  it('blocks unavailable product for entire checkout', () => {
    const result = resolveCheckoutLines({
      items: [
        {
          id: 1,
          productId: 9,
          productAttributeValueId: null,
          quantity: 1,
        },
      ],
      productsById: new Map(),
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues[0].code).toBe('unavailable');
    }
  });

  it('snapshots selectable product line prices from DB fields', () => {
    const result = resolveCheckoutLines({
      items: [
        {
          id: 1,
          productId: 3,
          productAttributeValueId: null,
          quantity: 2,
        },
      ],
      productsById: new Map([
        [
          3,
          {
            id: 3,
            name: 'کفش',
            price: 100,
            discountedPrice: 80,
            quantity: 10,
            isSellable: true,
            isDeleted: false,
            status: 'active',
            categoryId: 2,
            coverPath: null,
            productAttributeValues: [],
          },
        ],
      ]),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines[0].productName).toBe('کفش');
      expect(result.lines[0].unitPriceTry).toBe(80);
      expect(result.lines[0].lineTotalTry).toBe(160);
      expect(result.lines[0].priceTry).toBe(100);
    }
  });

  it('blocks uncurated external products even when assortment enforcement is off', () => {
    const result = resolveCheckoutLines({
      items: [
        {
          id: 1,
          productId: 156276,
          productAttributeValueId: null,
          quantity: 1,
        },
      ],
      productsById: new Map([
        [
          156276,
          {
            id: 156276,
            name: 'Dog collar',
            price: 100,
            discountedPrice: 0,
            quantity: -1,
            isSellable: true,
            isDeleted: false,
            status: 'active',
            categoryId: 145,
            coverPath: null,
            supplyType: 'external_source',
            isCuratedExternalCatalog: false,
            productAttributeValues: [],
          },
        ],
      ]),
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues[0].code).toBe('unavailable');
      expect(result.issues[0].message).toContain('بررسی');
    }
  });

  it('blocks insufficient stock', () => {
    const result = resolveCheckoutLines({
      items: [
        {
          id: 1,
          productId: 3,
          productAttributeValueId: null,
          quantity: 5,
        },
      ],
      productsById: new Map([
        [
          3,
          {
            id: 3,
            name: 'کفش',
            price: 100,
            discountedPrice: null,
            quantity: 2,
            isSellable: true,
            isDeleted: false,
            status: 'active',
            categoryId: 2,
            coverPath: null,
            productAttributeValues: [],
          },
        ],
      ]),
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues[0].code).toBe('insufficient_stock');
    }
  });

  it('blocks missing required configuration', () => {
    const result = resolveCheckoutLines({
      items: [
        {
          id: 1,
          productId: 3,
          productAttributeValueId: null,
          quantity: 1,
        },
      ],
      productsById: new Map([
        [
          3,
          {
            id: 3,
            name: 'پیراهن',
            price: 100,
            discountedPrice: null,
            quantity: 10,
            isSellable: true,
            isDeleted: false,
            status: 'active',
            categoryId: 2,
            coverPath: null,
            productAttributeValues: [
              {
                id: 50,
                quantity: 5,
                price: null,
                discountedPrice: null,
                attributeValue: {
                  id: 1,
                  name: 'M',
                  extraValue: null,
                  attributeId: 7,
                  attribute: {
                    id: 7,
                    name: 'سایز',
                    type: 'other',
                  },
                },
              },
              {
                id: 51,
                quantity: 5,
                price: null,
                discountedPrice: null,
                attributeValue: {
                  id: 2,
                  name: 'L',
                  extraValue: null,
                  attributeId: 7,
                  attribute: {
                    id: 7,
                    name: 'سایز',
                    type: 'other',
                  },
                },
              },
            ],
          },
        ],
      ]),
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues[0].code).toBe('invalid_config');
    }
  });

  it('rejects stocked variant when product isSellable=false', () => {
    const result = resolveCheckoutLines({
      items: [
        {
          id: 1,
          productId: 3,
          productAttributeValueId: 50,
          quantity: 1,
        },
      ],
      productsById: new Map([
        [
          3,
          {
            id: 3,
            name: 'پیراهن',
            price: 100,
            discountedPrice: null,
            quantity: 10,
            isSellable: false,
            isDeleted: false,
            status: 'active',
            categoryId: 2,
            coverPath: null,
            productAttributeValues: [
              {
                id: 50,
                quantity: 5,
                price: 120,
                discountedPrice: null,
                attributeValue: {
                  id: 1,
                  name: 'M',
                  extraValue: null,
                  attributeId: 7,
                  attribute: {
                    id: 7,
                    name: 'سایز',
                    type: 'other',
                  },
                },
              },
              {
                id: 51,
                quantity: 5,
                price: 130,
                discountedPrice: null,
                attributeValue: {
                  id: 2,
                  name: 'L',
                  extraValue: null,
                  attributeId: 7,
                  attribute: {
                    id: 7,
                    name: 'سایز',
                    type: 'other',
                  },
                },
              },
            ],
          },
        ],
      ]),
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues[0].code).toBe('unavailable');
    }
  });

  it('accepts stocked variant when product is sellable', () => {
    const result = resolveCheckoutLines({
      items: [
        {
          id: 1,
          productId: 3,
          productAttributeValueId: 50,
          quantity: 1,
        },
      ],
      productsById: new Map([
        [
          3,
          {
            id: 3,
            name: 'پیراهن',
            price: 100,
            discountedPrice: null,
            quantity: 10,
            isSellable: true,
            isDeleted: false,
            status: 'active',
            categoryId: 2,
            coverPath: null,
            productAttributeValues: [
              {
                id: 50,
                quantity: 5,
                price: 120,
                discountedPrice: null,
                attributeValue: {
                  id: 1,
                  name: 'M',
                  extraValue: null,
                  attributeId: 7,
                  attribute: {
                    id: 7,
                    name: 'سایز',
                    type: 'other',
                  },
                },
              },
              {
                id: 51,
                quantity: 5,
                price: 130,
                discountedPrice: null,
                attributeValue: {
                  id: 2,
                  name: 'L',
                  extraValue: null,
                  attributeId: 7,
                  attribute: {
                    id: 7,
                    name: 'سایز',
                    type: 'other',
                  },
                },
              },
            ],
          },
        ],
      ]),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines[0].unitPriceTry).toBe(120);
      expect(result.lines[0].productAttributeValueId).toBe(50);
    }
  });
});

describe('roundMoney', () => {
  it('rounds to 2 decimals', () => {
    expect(roundMoney(10.005)).toBe(10.01);
  });
});
