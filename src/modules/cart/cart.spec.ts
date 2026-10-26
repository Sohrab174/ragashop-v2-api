import { buildCartConfigKey, parseCartConfigKey } from './cart-config-key';
import {
  CART_MAX_LINE_QUANTITY,
  clampCartQuantityAgainstStock,
  isValidCartSessionKey,
  resolveCartStockCeiling,
} from './cart-stock';
import { resolveCartLineConfig } from './cart-line.resolve';
import {
  mapStorefrontCartResponse,
  resolveCartProductImagePath,
} from './cart-read.mapper';
import { ProductGalleryType } from '../product/entities/product-gallery.entity';
import { ProductStatus } from '../product/entities/product.entity';

function expectFailCode(
  result: { ok: true } | { ok: false; failure: { code: string } },
  code: string,
) {
  expect(result.ok).toBe(false);
  if (result.ok === false) {
    expect(result.failure.code).toBe(code);
  }
}

describe('cart-config-key', () => {
  it('builds deterministic keys for product + PAV', () => {
    expect(buildCartConfigKey(12, 34)).toBe('12:34');
    expect(buildCartConfigKey(12, null)).toBe('12:0');
    expect(buildCartConfigKey(12, undefined)).toBe('12:0');
  });

  it('parses config keys', () => {
    expect(parseCartConfigKey('12:34')).toEqual({
      productId: 12,
      productAttributeValueId: 34,
    });
    expect(parseCartConfigKey('12:0')).toEqual({
      productId: 12,
      productAttributeValueId: null,
    });
  });

  it('same product different PAV are different keys', () => {
    expect(buildCartConfigKey(1, 10)).not.toBe(buildCartConfigKey(1, 11));
  });
});

describe('cart-stock', () => {
  it('treats -1 as unlimited', () => {
    expect(resolveCartStockCeiling(-1)).toEqual({
      maxQuantity: null,
      available: true,
    });
  });

  it('treats 0 as out of stock', () => {
    expect(resolveCartStockCeiling(0)).toEqual({
      maxQuantity: 0,
      available: false,
    });
  });

  it('caps finite stock at CART_MAX_LINE_QUANTITY', () => {
    expect(resolveCartStockCeiling(500).maxQuantity).toBe(
      CART_MAX_LINE_QUANTITY,
    );
  });

  it('rejects quantity above stock', () => {
    const result = clampCartQuantityAgainstStock(5, {
      maxQuantity: 3,
      available: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('exceeds_stock');
    }
  });

  it('validates session keys', () => {
    expect(isValidCartSessionKey('550e8400-e29b-41d4-a716-446655440000')).toBe(
      true,
    );
    expect(isValidCartSessionKey('not-a-session')).toBe(false);
    expect(isValidCartSessionKey('')).toBe(false);
  });
});

function baseProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    name: 'پیراهن تست',
    price: 100,
    discountedPrice: 80,
    quantity: 5,
    isSellable: true,
    isDeleted: false,
    status: ProductStatus.active,
    categoryId: 20,
    coverPath: '/products/a.jpg',
    productAttributeValues: [] as any[],
    ...overrides,
  };
}

function sizePavs() {
  return [
    {
      id: 101,
      quantity: 3,
      price: null,
      discountedPrice: null,
      attributeValue: {
        id: 1,
        name: 'S',
        attributeId: 7,
        attribute: { id: 7, name: 'سایز', type: 'other' },
      },
    },
    {
      id: 102,
      quantity: 2,
      price: null,
      discountedPrice: null,
      attributeValue: {
        id: 2,
        name: 'M',
        attributeId: 7,
        attribute: { id: 7, name: 'سایز', type: 'other' },
      },
    },
    {
      id: 103,
      quantity: 0,
      price: null,
      discountedPrice: null,
      attributeValue: {
        id: 3,
        name: 'L',
        attributeId: 7,
        attribute: { id: 7, name: 'سایز', type: 'other' },
      },
    },
  ];
}

describe('resolveCartLineConfig', () => {
  it('adds normal product without options', () => {
    const result = resolveCartLineConfig({
      product: baseProduct({ quantity: -1 }),
      quantity: 2,
      selections: [],
      tryToToman: 1000,
    });
    expect(result.ok).toBe(true);
    if (result.ok !== true) return;
    expect(result.config.configKey).toBe('10:0');
    expect(result.config.quantity).toBe(2);
    expect(result.config.unitPriceTry).toBe(80);
    expect(result.config.compareAtPriceTry).toBe(100);
  });

  it('refuses missing or zero FX instead of inventing rate 1', () => {
    const missing = resolveCartLineConfig({
      product: baseProduct({ quantity: -1 }),
      quantity: 1,
      selections: [],
    });
    expect(missing.ok).toBe(false);
    if (missing.ok !== false) return;
    expect(missing.failure.code).toBe('fx_rate_unavailable');

    const zero = resolveCartLineConfig({
      product: baseProduct({ quantity: -1 }),
      quantity: 1,
      selections: [],
      tryToToman: 0,
    });
    expect(zero.ok).toBe(false);
    if (zero.ok !== false) return;
    expect(zero.failure.code).toBe('fx_rate_unavailable');
  });

  it('same product + same config shares configKey', () => {
    const product = baseProduct({ productAttributeValues: sizePavs() });
    const a = resolveCartLineConfig({
      product,
      quantity: 1,
      selections: [{ attributeId: 7, valueId: 101 }],
      tryToToman: 1,
    });
    const b = resolveCartLineConfig({
      product,
      quantity: 1,
      selections: [{ attributeId: 7, valueId: 101 }],
      tryToToman: 1,
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok !== true || b.ok !== true) return;
    expect(a.config.configKey).toBe(b.config.configKey);
  });

  it('same product + different config has different configKey', () => {
    const product = baseProduct({ productAttributeValues: sizePavs() });
    const a = resolveCartLineConfig({
      product,
      quantity: 1,
      selections: [{ attributeId: 7, valueId: 101 }],
      tryToToman: 1,
    });
    const b = resolveCartLineConfig({
      product,
      quantity: 1,
      selections: [{ attributeId: 7, valueId: 102 }],
      tryToToman: 1,
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok !== true || b.ok !== true) return;
    expect(a.config.configKey).not.toBe(b.config.configKey);
  });

  it('rejects missing required option', () => {
    expectFailCode(
      resolveCartLineConfig({
        product: baseProduct({ productAttributeValues: sizePavs() }),
        quantity: 1,
        selections: [],
        tryToToman: 1,
      }),
      'missing_option',
    );
  });

  it('rejects foreign option value', () => {
    expectFailCode(
      resolveCartLineConfig({
        product: baseProduct({ productAttributeValues: sizePavs() }),
        quantity: 1,
        selections: [{ attributeId: 7, valueId: 99999 }],
        tryToToman: 1,
      }),
      'invalid_option',
    );
  });

  it('rejects foreign attribute id', () => {
    expectFailCode(
      resolveCartLineConfig({
        product: baseProduct({ productAttributeValues: sizePavs() }),
        quantity: 1,
        selections: [{ attributeId: 99, valueId: 101 }],
        tryToToman: 1,
      }),
      'invalid_option',
    );
  });

  it('normalizes duplicate same selection', () => {
    const result = resolveCartLineConfig({
      product: baseProduct({ productAttributeValues: sizePavs() }),
      quantity: 1,
      selections: [
        { attributeId: 7, valueId: 101 },
        { attributeId: 7, valueId: 101 },
      ],
      tryToToman: 1,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects conflicting duplicate selections', () => {
    expectFailCode(
      resolveCartLineConfig({
        product: baseProduct({ productAttributeValues: sizePavs() }),
        quantity: 1,
        selections: [
          { attributeId: 7, valueId: 101 },
          { attributeId: 7, valueId: 102 },
        ],
        tryToToman: 1,
      }),
      'invalid_option',
    );
  });

  it('rejects invalid quantity', () => {
    expectFailCode(
      resolveCartLineConfig({
        product: baseProduct({ quantity: -1 }),
        quantity: 0,
        selections: [],
        tryToToman: 1,
      }),
      'invalid_quantity',
    );
  });

  it('rejects quantity > stock', () => {
    expectFailCode(
      resolveCartLineConfig({
        product: baseProduct({ quantity: 2 }),
        quantity: 5,
        selections: [],
        tryToToman: 1,
      }),
      'exceeds_stock',
    );
  });

  it('rejects out of stock option', () => {
    expectFailCode(
      resolveCartLineConfig({
        product: baseProduct({ productAttributeValues: sizePavs() }),
        quantity: 1,
        selections: [{ attributeId: 7, valueId: 103 }],
        tryToToman: 1,
      }),
      'out_of_stock',
    );
  });

  it('rejects non-sellable product', () => {
    expectFailCode(
      resolveCartLineConfig({
        product: baseProduct({ isSellable: false, quantity: -1 }),
        quantity: 1,
        selections: [],
        tryToToman: 1,
      }),
      'not_sellable',
    );
  });

  it('computes real-sale price and ignores frontend price fields', () => {
    const result = resolveCartLineConfig({
      product: baseProduct({
        price: 200,
        discountedPrice: 150,
        quantity: -1,
      }),
      quantity: 1,
      selections: [],
      tryToToman: 10,
    });
    expect(result.ok).toBe(true);
    if (result.ok !== true) return;
    expect(result.config.unitPriceTry).toBe(150);
    expect(result.config.compareAtPriceTry).toBe(200);
  });

  it('rejects invisible product', () => {
    expectFailCode(
      resolveCartLineConfig({
        product: baseProduct({ isDeleted: true }),
        quantity: 1,
        selections: [],
        tryToToman: 1,
      }),
      'product_not_found',
    );
  });
});

describe('resolveCartProductImagePath', () => {
  it('uses the product cover when present', () => {
    expect(
      resolveCartProductImagePath({
        cover: { pathFile: '/products/cover.jpg' },
        productGalleries: [
          { pathFile: '/products/other.jpg', type: ProductGalleryType.photo },
        ],
      }),
    ).toBe('/products/cover.jpg');
  });

  it('falls back to the first photo gallery when cover is missing', () => {
    expect(
      resolveCartProductImagePath({
        cover: { pathFile: '   ' },
        productGalleries: [
          { pathFile: '/products/v.mp4', type: ProductGalleryType.video },
          { pathFile: '/products/g1.jpg', type: ProductGalleryType.photo },
        ],
      }),
    ).toBe('/products/g1.jpg');
  });

  it('returns null when no usable image exists', () => {
    expect(
      resolveCartProductImagePath({
        cover: null,
        productGalleries: [{ pathFile: '', type: ProductGalleryType.photo }],
      }),
    ).toBeNull();
  });
});

describe('mapStorefrontCartResponse', () => {
  it('reads cart with live price and subtotal', () => {
    const productsById = new Map([
      [
        10,
        baseProduct({
          price: 100,
          discountedPrice: 80,
          quantity: -1,
        }),
      ],
    ]);
    const cart = mapStorefrontCartResponse({
      sessionKey: '550e8400-e29b-41d4-a716-446655440000',
      items: [
        {
          id: 1,
          productId: 10,
          productAttributeValueId: null,
          quantity: 2,
        },
      ],
      productsById: productsById as any,
      tryToToman: 1000,
    });
    expect(cart.itemCount).toBe(2);
    expect(cart.subtotal).toBe(160000);
    expect(cart.items[0].unitPrice).toBe(80000);
    expect(cart.items[0].available).toBe(true);
  });

  it('marks stale unavailable product without crashing', () => {
    const productsById = new Map([
      [10, baseProduct({ isDeleted: true, quantity: 0 })],
    ]);
    const cart = mapStorefrontCartResponse({
      sessionKey: null,
      items: [
        {
          id: 1,
          productId: 10,
          productAttributeValueId: null,
          quantity: 1,
        },
      ],
      productsById: productsById as any,
      tryToToman: 1000,
    });
    expect(cart.items[0].available).toBe(false);
    expect(cart.subtotal).toBe(0);
    expect(cart.itemCount).toBe(0);
  });

  it('marks quantity above stock as unavailable', () => {
    const productsById = new Map([
      [10, baseProduct({ quantity: 1, discountedPrice: null, price: 50 })],
    ]);
    const cart = mapStorefrontCartResponse({
      sessionKey: null,
      items: [
        {
          id: 1,
          productId: 10,
          productAttributeValueId: null,
          quantity: 5,
        },
      ],
      productsById: productsById as any,
      tryToToman: 1,
    });
    expect(cart.items[0].available).toBe(false);
    expect(cart.items[0].availabilityNote).toContain('موجودی');
  });
});
