import { HttpException } from '@nestjs/common';
import {
  buildCheckoutConfirmationToken,
  buildOwnerScopedIdempotencyKey,
  generateGuestAccessToken,
} from './checkout-fingerprint';
import { computeCheckoutTotals } from './checkout-totals';
import { toToman } from '../cart/cart-line.resolve';

const mockQueryRunner = {
  connect: jest.fn(),
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
  release: jest.fn(),
  manager: {
    findOne: jest.fn(),
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  },
};

jest.mock('typeorm', () => {
  const actual = jest.requireActual('typeorm');
  return {
    ...actual,
    getConnection: jest.fn(() => ({
      createQueryRunner: () => mockQueryRunner,
    })),
  };
});

import { CheckoutService } from './checkout.service';
import { OrderStatus } from '../order/entities/order.entity';

describe('CheckoutService create/ownership (Checkout-1)', () => {
  let service: CheckoutService;
  let mockError: any;
  let mockCartService: any;
  let mockSettingService: any;
  let mockProductService: any;
  let mockCartRepository: any;
  let mockCartItemRepository: any;
  let mockOrderRepository: any;
  let mockCityRepository: any;
  let mockProductRepository: any;
  let insertedOrders: any[];
  let insertedItems: any[];
  let deletedCartItems: boolean;
  let updatedCart: any;

  beforeEach(() => {
    insertedOrders = [];
    insertedItems = [];
    deletedCartItems = false;
    updatedCart = null;

    mockQueryRunner.connect.mockClear();
    mockQueryRunner.startTransaction.mockClear();
    mockQueryRunner.commitTransaction.mockClear();
    mockQueryRunner.rollbackTransaction.mockClear();
    mockQueryRunner.release.mockClear();

    mockError = {
      unprocessableEntity: jest.fn((msgs, data) => {
        throw new HttpException({ messages: msgs, data }, 422);
      }),
      conflict: jest.fn((msgs, data) => {
        throw new HttpException({ messages: msgs, data }, 409);
      }),
      notFound: jest.fn((msgs) => {
        throw new HttpException({ messages: msgs }, 404);
      }),
      forbidden: jest.fn((msgs) => {
        throw new HttpException({ messages: msgs }, 403);
      }),
      methodNotAllowed: jest.fn((msgs) => {
        throw new HttpException({ messages: msgs }, 405);
      }),
    };

    mockCartService = {
      resolveOwner: jest.fn((customer, session) => ({
        customerId: customer?.id ?? null,
        sessionKey: session || null,
      })),
      ensureSessionKey: jest.fn((owner) => owner.sessionKey || 'sess-1'),
    };

    mockSettingService = {
      getByAdmin: jest.fn().mockResolvedValue({
        taxPercent: 0,
        shippingPercent: 0,
        maxShippingCost: 0,
      }),
      getTryToToman: jest.fn().mockResolvedValue(1000),
      requireFreshAuthoritativeTryToToman: jest.fn().mockResolvedValue({
        tryToToman: 1000,
        tryToRialRaw: 10000,
        tryToRialEffective: 10000,
        source: 'TGJU',
        fetchedAt: new Date(),
        ageMs: 0,
        isFresh: true,
        maxAgeMs: 900000,
      }),
    };

    mockProductService = {
      decrementQuantity: jest.fn().mockResolvedValue(true),
      decrementAttributeQuantity: jest.fn().mockResolvedValue(true),
    };

    mockCartRepository = {};
    mockCartItemRepository = {};
    mockOrderRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(),
    };
    mockCityRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 1, name: 'تهران' }),
    };
    mockProductRepository = {
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 3,
            name: 'کفش',
            price: 100,
            discountedPrice: null,
            quantity: 10,
            isSellable: true,
            isDeleted: false,
            status: 'active',
            categoryId: 2,
            cover: null,
            productAttributeValues: [],
          },
        ]),
      })),
    };

    const cart = {
      id: 55,
      sessionKey: 'sess-1',
      customerId: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastConvertedOrderId: null,
    };

    mockQueryRunner.manager.findOne = jest.fn(
      async (entity: any, opts: any) => {
        if (opts?.where?.checkoutIdempotencyKey) return null;
        if (opts?.where?.id && entity?.name === 'OrderEntity') return null;
        return null;
      },
    );

    mockQueryRunner.manager.find = jest.fn(async () => [
      {
        id: 1,
        productId: 3,
        productAttributeValueId: null,
        quantity: 2,
      },
    ]);

    // lockCart uses createQueryBuilder on CartEntity
    const qbPhase: 'cart' | 'orderInsert' | 'itemInsert' | 'delete' | 'update' =
      'cart';

    mockQueryRunner.manager.createQueryBuilder = jest.fn((entity?: any) => {
      const qb: any = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn(async () => {
          if (entity?.name === 'CartEntity' || entity === undefined) {
            return cart;
          }
          // last order for number generation
          return { id: 10, number: '14040110' };
        }),
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn((values: any) => {
          if (Array.isArray(values)) {
            insertedItems.push(...values);
          } else {
            insertedOrders.push(values);
          }
          return {
            execute: jest.fn().mockResolvedValue({
              identifiers: [{ id: 99 }],
            }),
          };
        }),
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        set: jest.fn((v: any) => {
          updatedCart = v;
          return qb;
        }),
        execute: jest.fn(async () => {
          deletedCartItems = true;
          return undefined;
        }),
      };
      void qbPhase;
      return qb;
    });

    service = new CheckoutService(
      mockCartRepository,
      mockCartItemRepository,
      mockOrderRepository,
      {} as any,
      mockProductRepository,
      mockCityRepository,
      mockCartService,
      mockSettingService,
      mockProductService,
      mockError,
      { getStatusMapForCategories: jest.fn(async () => new Map()) } as any,
    );

    // mapOrderConfirmation after create — guestAccessToken must match create path arg
    mockOrderRepository.createQueryBuilder = jest.fn(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockImplementation(async () => {
        const token =
          insertedOrders[0]?.guestAccessToken || 'guest-token-fallback';
        return {
          id: 99,
          number: '14040111',
          status: OrderStatus.pending,
          customerId: null,
          guestAccessToken: token,
          amount: 200,
          discount: 0,
          shipping: 0,
          tax: 0,
          finalAmount: 200,
          commercialCurrency: insertedOrders[0]?.commercialCurrency ?? 'TRY',
          fxRateToIrt: insertedOrders[0]?.fxRateToIrt ?? null,
          successfulTransactionId: null,
          firstName: 'علی',
          lastName: 'تست',
          phone: '+989121234567',
          address: 'آدرس تست طولانی',
          addressDetails: null,
          postalCode: null,
          cityId: 1,
          description: null,
          createdAt: new Date(),
          isDeleted: false,
          orderItems: [
            {
              id: 1,
              productId: 3,
              productName: 'کفش',
              optionName: null,
              optionLabel: null,
              price: 100,
              discountedPrice: 0,
              quantity: 2,
              finalAmount: 200,
            },
          ],
          city: { name: 'تهران', province: { name: 'تهران' } },
        };
      }),
    }));
  });

  function confirmationForCart(tryToToman = 1000) {
    const lines = [
      {
        productId: 3,
        productAttributeValueId: null as number | null,
        quantity: 2,
        unitPriceTry: 100,
      },
    ];
    const subtotalTry = 200;
    const totals = computeCheckoutTotals(subtotalTry, {
      shippingPercent: 0,
      maxShippingCost: 0,
      taxPercent: 0,
    });
    return buildCheckoutConfirmationToken({
      cartId: 55,
      cartUpdatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      lines,
      subtotalTry,
      shippingTry: totals.shippingTry,
      taxTry: totals.taxTry,
      payableTry: totals.payableTry,
      tryToToman,
    });
  }

  function scopedKey(
    clientKey: string,
    owner: { customerId: number | null; sessionKey: string | null },
  ) {
    return buildOwnerScopedIdempotencyKey({
      clientKey,
      customerId: owner.customerId,
      sessionKey: owner.customerId != null ? null : owner.sessionKey,
    });
  }

  function mockMappedOrder(partial: Record<string, unknown>) {
    mockOrderRepository.createQueryBuilder = jest.fn(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 77,
        number: '14040177',
        status: OrderStatus.pending,
        customerId: null,
        guestAccessToken: 'tok-a',
        amount: 100,
        discount: 0,
        shipping: 0,
        tax: 0,
        finalAmount: 100,
        firstName: 'علی',
        lastName: 'تست',
        phone: '+989121234567',
        address: 'آدرس',
        addressDetails: null,
        postalCode: null,
        cityId: 1,
        description: null,
        createdAt: new Date(),
        isDeleted: false,
        orderItems: [],
        city: null,
        ...partial,
      }),
    }));
  }

  it('creates one pending order from valid cart with snapshots', async () => {
    const token = confirmationForCart();
    const order = await service.createOrderWithCityCheck(
      { customerId: null, sessionKey: 'sess-1' },
      {
        confirmationToken: token,
        firstName: 'علی',
        lastName: 'تست',
        phone: '09121234567',
        address: 'خیابان تست پلاک ۱۲',
        cityId: 1,
      },
      '550e8400-e29b-41d4-a716-446655440000',
    );

    expect(order.id).toBe(99);
    expect(order.status).toBe(OrderStatus.pending);
    expect(order.paymentStatus).toBe('awaiting_payment');
    expect(order.paymentStatusLabel).toBe('در انتظار پرداخت');
    expect(insertedItems[0].productName).toBe('کفش');
    expect(insertedItems[0].price).toBe(100);
    expect(insertedItems[0].quantity).toBe(2);
    expect(insertedOrders[0].checkoutIdempotencyKey).toBe(
      scopedKey('550e8400-e29b-41d4-a716-446655440000', {
        customerId: null,
        sessionKey: 'sess-1',
      }),
    );
    expect(insertedOrders[0].commercialCurrency).toBe('TRY');
    expect(insertedOrders[0].fxRateToIrt).toBe(1000);
    expect(insertedOrders[0].fxCapturedAt).toBeInstanceOf(Date);
    expect(insertedOrders[0].fxRateSource).toBe('TGJU');
    expect(insertedItems[0].unitLandedCostSnapshot).toBeNull();
    expect(insertedItems[0].cogsStatus).toBe('missing');
    expect(mockProductService.decrementQuantity).toHaveBeenCalled();
    expect(deletedCartItems).toBe(true);
    expect(updatedCart.lastConvertedOrderId).toBe(99);
    expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('ignores client price injection (DTO has no price fields)', async () => {
    const token = confirmationForCart();
    const dto: any = {
      confirmationToken: token,
      firstName: 'علی',
      lastName: 'تست',
      phone: '09121234567',
      address: 'خیابان تست پلاک ۱۲',
      cityId: 1,
      payableTotal: 1,
      finalAmount: 1,
      unitPrice: 1,
    };
    const order = await service.createOrderWithCityCheck(
      { customerId: null, sessionKey: 'sess-1' },
      dto,
      '550e8400-e29b-41d4-a716-446655440001',
    );
    expect(order.payableTotal).toBe(200000); // 200 TRY * 1000
    expect(insertedOrders[0].finalAmount).toBe(200);
  });

  it('rejects confirmation token when cart/price state changed', async () => {
    await expect(
      service.createOrderWithCityCheck(
        { customerId: null, sessionKey: 'sess-1' },
        {
          confirmationToken: 'stale-token',
          firstName: 'علی',
          lastName: 'تست',
          phone: '09121234567',
          address: 'خیابان تست پلاک ۱۲',
          cityId: 1,
        },
        '550e8400-e29b-41d4-a716-446655440002',
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(deletedCartItems).toBe(false);
  });

  it('rejects malformed delivery fields', async () => {
    await expect(
      service.createOrderWithCityCheck(
        { customerId: null, sessionKey: 'sess-1' },
        {
          confirmationToken: confirmationForCart(),
          firstName: '',
          lastName: '',
          phone: 'bad',
          address: 'x',
          cityId: 1,
        },
        '550e8400-e29b-41d4-a716-446655440003',
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('snapshots postal code and coordinates onto the order row', async () => {
    await service.createOrderWithCityCheck(
      { customerId: null, sessionKey: 'sess-1' },
      {
        confirmationToken: confirmationForCart(),
        firstName: 'علی',
        lastName: 'تست',
        phone: '09121234567',
        address: 'خیابان تست پلاک ۱۲',
        postalCode: '0123456789',
        latitude: 35.6892,
        longitude: 51.389,
        cityId: 1,
      } as any,
      '550e8400-e29b-41d4-a716-446655440010',
    );
    expect(insertedOrders[0]).toMatchObject({
      postalCode: '0123456789',
      latitude: 35.6892,
      longitude: 51.389,
      location: '35.6892000,51.3890000',
    });
    expect(insertedOrders[0]).not.toHaveProperty('addressId');
  });

  it('stores null coordinates when checkout sends no map pin (never 0,0)', async () => {
    await service.createOrderWithCityCheck(
      { customerId: null, sessionKey: 'sess-1' },
      {
        confirmationToken: confirmationForCart(),
        firstName: 'علی',
        lastName: 'تست',
        phone: '09121234567',
        address: 'خیابان تست پلاک ۱۲',
        cityId: 1,
      },
      '550e8400-e29b-41d4-a716-446655440011',
    );
    expect(insertedOrders[0].latitude).toBeNull();
    expect(insertedOrders[0].longitude).toBeNull();
    expect(insertedOrders[0].location).toBeNull();
    expect(insertedOrders[0].postalCode).toBeNull();
  });

  it('normalizes a hyphenated / Persian-digit postal code keeping leading zeros', async () => {
    await service.createOrderWithCityCheck(
      { customerId: null, sessionKey: 'sess-1' },
      {
        confirmationToken: confirmationForCart(),
        firstName: 'علی',
        lastName: 'تست',
        phone: '09121234567',
        address: 'خیابان تست پلاک ۱۲',
        postalCode: ' ۰۱۲۳۴-۵۶۷۸۹ ',
        cityId: 1,
      } as any,
      '550e8400-e29b-41d4-a716-446655440013',
    );
    expect(insertedOrders[0].postalCode).toBe('0123456789');
  });

  it('rejects out-of-range or half-specified checkout coordinates', async () => {
    for (const geo of [
      { latitude: 95, longitude: 51 },
      { latitude: 35, longitude: -181 },
      { latitude: 35 },
      { latitude: 'NaN', longitude: 51 },
      { latitude: 0, longitude: 0 },
      { postalCode: '12345' },
    ]) {
      await expect(
        service.createOrderWithCityCheck(
          { customerId: null, sessionKey: 'sess-1' },
          {
            confirmationToken: confirmationForCart(),
            firstName: 'علی',
            lastName: 'تست',
            phone: '09121234567',
            address: 'خیابان تست پلاک ۱۲',
            cityId: 1,
            ...geo,
          } as any,
          '550e8400-e29b-41d4-a716-446655440012',
        ),
      ).rejects.toMatchObject({ status: 422 });
    }
  });

  it('returns existing order for duplicate idempotency key', async () => {
    const clientKey = '550e8400-e29b-41d4-a716-446655440099';
    const owner = { customerId: null as number | null, sessionKey: 'sess-1' };
    const digest = scopedKey(clientKey, owner);
    mockOrderRepository.findOne.mockResolvedValue({
      id: 77,
      customerId: null,
      guestAccessToken: 'tok',
      checkoutIdempotencyKey: digest,
    });
    mockMappedOrder({
      id: 77,
      guestAccessToken: 'tok',
      checkoutIdempotencyKey: digest,
    });

    const order = await service.createOrderWithCityCheck(
      owner,
      {
        confirmationToken: 'anything',
        firstName: 'علی',
        lastName: 'تست',
        phone: '09121234567',
        address: 'خیابان تست پلاک ۱۲',
        cityId: 1,
      },
      clientKey,
    );
    expect(order.id).toBe(77);
    expect(mockQueryRunner.startTransaction).not.toHaveBeenCalled();
    expect(mockOrderRepository.findOne).toHaveBeenCalledWith({
      where: { checkoutIdempotencyKey: digest },
    });
  });

  it('isolates guest B from guest A when reusing the same raw idempotency key', async () => {
    const clientKey = '550e8400-e29b-41d4-a716-4466554400aa';
    const digestA = scopedKey(clientKey, {
      customerId: null,
      sessionKey: 'sess-A',
    });
    const digestB = scopedKey(clientKey, {
      customerId: null,
      sessionKey: 'sess-B',
    });
    expect(digestA).not.toBe(digestB);

    mockOrderRepository.findOne.mockImplementation(async (opts: any) => {
      if (opts?.where?.checkoutIdempotencyKey === digestA) {
        return {
          id: 77,
          customerId: null,
          guestAccessToken: 'tok-A-SECRET',
          checkoutIdempotencyKey: digestA,
        };
      }
      return null;
    });

    // Guest B cart + create path
    mockCartService.ensureSessionKey.mockImplementation(
      (owner: any) => owner.sessionKey || 'sess-B',
    );

    const orderB = await service.createOrderWithCityCheck(
      { customerId: null, sessionKey: 'sess-B' },
      {
        confirmationToken: confirmationForCart(),
        firstName: 'علی',
        lastName: 'تست',
        phone: '09121234567',
        address: 'خیابان تست پلاک ۱۲',
        cityId: 1,
      },
      clientKey,
    );

    expect(orderB.id).toBe(99);
    expect(orderB.accessToken).not.toBe('tok-A-SECRET');
    expect(insertedOrders[0].checkoutIdempotencyKey).toBe(digestB);
    expect(insertedOrders[0].checkoutIdempotencyKey).not.toBe(digestA);
    expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
  });

  it('isolates customer B from customer A when reusing the same raw idempotency key', async () => {
    const clientKey = '550e8400-e29b-41d4-a716-4466554400bb';
    const digestA = scopedKey(clientKey, { customerId: 1, sessionKey: null });
    const digestB = scopedKey(clientKey, { customerId: 2, sessionKey: null });
    expect(digestA).not.toBe(digestB);

    mockOrderRepository.findOne.mockImplementation(async (opts: any) => {
      if (opts?.where?.checkoutIdempotencyKey === digestA) {
        return {
          id: 88,
          customerId: 1,
          guestAccessToken: null,
          checkoutIdempotencyKey: digestA,
        };
      }
      return null;
    });

    // Authenticated cart lock path uses customerId
    mockQueryRunner.manager.createQueryBuilder = jest.fn((entity?: any) => {
      const qb: any = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn(async () => {
          if (entity?.name === 'CartEntity' || entity === undefined) {
            return {
              id: 55,
              sessionKey: null,
              customerId: 2,
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
              lastConvertedOrderId: null,
            };
          }
          return { id: 10, number: '14040110' };
        }),
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn((values: any) => {
          if (Array.isArray(values)) {
            insertedItems.push(...values);
          } else {
            insertedOrders.push(values);
          }
          return {
            execute: jest.fn().mockResolvedValue({
              identifiers: [{ id: 99 }],
            }),
          };
        }),
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        set: jest.fn((v: any) => {
          updatedCart = v;
          return qb;
        }),
        execute: jest.fn(async () => {
          deletedCartItems = true;
          return undefined;
        }),
      };
      return qb;
    });

    mockOrderRepository.createQueryBuilder = jest.fn(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 99,
        number: '14040111',
        status: OrderStatus.pending,
        customerId: 2,
        guestAccessToken: null,
        amount: 200,
        discount: 0,
        shipping: 0,
        tax: 0,
        finalAmount: 200,
        firstName: 'علی',
        lastName: 'تست',
        phone: '+989121234567',
        address: 'آدرس تست طولانی',
        addressDetails: null,
        postalCode: null,
        cityId: 1,
        description: null,
        createdAt: new Date(),
        isDeleted: false,
        orderItems: [
          {
            id: 1,
            productId: 3,
            productName: 'کفش',
            optionName: null,
            optionLabel: null,
            price: 100,
            discountedPrice: 0,
            quantity: 2,
            finalAmount: 200,
          },
        ],
        city: { name: 'تهران', province: { name: 'تهران' } },
      }),
    }));

    const orderB = await service.createOrderWithCityCheck(
      { customerId: 2, sessionKey: null },
      {
        confirmationToken: confirmationForCart(),
        firstName: 'علی',
        lastName: 'تست',
        phone: '09121234567',
        address: 'خیابان تست پلاک ۱۲',
        cityId: 1,
      },
      clientKey,
    );

    expect(orderB.id).toBe(99);
    expect(orderB.id).not.toBe(88);
    expect(insertedOrders[0].customerId).toBe(2);
    expect(insertedOrders[0].checkoutIdempotencyKey).toBe(digestB);
  });

  it('rejects confirmation token when only tryToToman rate changes', async () => {
    const tokenR1 = confirmationForCart(1000);
    expect(toToman(200, 1000)).toBe(200000);
    expect(toToman(200, 2000)).toBe(400000);

    mockSettingService.getTryToToman.mockResolvedValue(2000);
    mockSettingService.requireFreshAuthoritativeTryToToman.mockResolvedValue({
      tryToToman: 2000,
      tryToRialRaw: 20000,
      tryToRialEffective: 20000,
      source: 'TGJU',
      fetchedAt: new Date(),
      ageMs: 0,
      isFresh: true,
      maxAgeMs: 900000,
    });

    await expect(
      service.createOrderWithCityCheck(
        { customerId: null, sessionKey: 'sess-1' },
        {
          confirmationToken: tokenR1,
          firstName: 'علی',
          lastName: 'تست',
          phone: '09121234567',
          address: 'خیابان تست پلاک ۱۲',
          cityId: 1,
        },
        '550e8400-e29b-41d4-a716-4466554400cc',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { data: { code: 'checkout_state_changed' } },
    });

    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(deletedCartItems).toBe(false);
    expect(mockProductService.decrementQuantity).not.toHaveBeenCalled();
    expect(insertedOrders.length).toBe(0);
  });

  it('accepts fresh confirmation token after rate change to R2', async () => {
    mockSettingService.getTryToToman.mockResolvedValue(2000);
    mockSettingService.requireFreshAuthoritativeTryToToman.mockResolvedValue({
      tryToToman: 2000,
      tryToRialRaw: 20000,
      tryToRialEffective: 20000,
      source: 'TGJU',
      fetchedAt: new Date(),
      ageMs: 0,
      isFresh: true,
      maxAgeMs: 900000,
    });
    const tokenR2 = confirmationForCart(2000);

    const order = await service.createOrderWithCityCheck(
      { customerId: null, sessionKey: 'sess-1' },
      {
        confirmationToken: tokenR2,
        firstName: 'علی',
        lastName: 'تست',
        phone: '09121234567',
        address: 'خیابان تست پلاک ۱۲',
        cityId: 1,
      },
      '550e8400-e29b-41d4-a716-4466554400dd',
    );

    expect(order.id).toBe(99);
    expect(order.payableTotal).toBe(400000); // 200 TRY * 2000
    expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('same guest owner concurrent same-key replay returns one order without second create', async () => {
    const clientKey = '550e8400-e29b-41d4-a716-4466554400ee';
    const owner = { customerId: null as number | null, sessionKey: 'sess-1' };
    const digest = scopedKey(clientKey, owner);

    // Simulate race: pre-txn miss, in-txn find hits existing
    mockOrderRepository.findOne.mockResolvedValue(null);
    mockQueryRunner.manager.findOne = jest.fn(
      async (_entity: any, opts: any) => {
        if (opts?.where?.checkoutIdempotencyKey === digest) {
          return {
            id: 77,
            customerId: null,
            guestAccessToken: 'tok-race',
            checkoutIdempotencyKey: digest,
          };
        }
        return null;
      },
    );
    mockMappedOrder({
      id: 77,
      guestAccessToken: 'tok-race',
    });

    const order = await service.createOrderWithCityCheck(
      owner,
      {
        confirmationToken: confirmationForCart(),
        firstName: 'علی',
        lastName: 'تست',
        phone: '09121234567',
        address: 'خیابان تست پلاک ۱۲',
        cityId: 1,
      },
      clientKey,
    );

    expect(order.id).toBe(77);
    expect(insertedOrders.length).toBe(0);
    expect(mockProductService.decrementQuantity).not.toHaveBeenCalled();
  });

  it('same cart different idempotency key returns prior conversion when cart already converted', async () => {
    mockOrderRepository.findOne.mockResolvedValue(null);
    mockQueryRunner.manager.find = jest.fn(async () => []);
    mockQueryRunner.manager.findOne = jest.fn(
      async (_entity: any, opts: any) => {
        if (opts?.where?.id === 66) {
          return {
            id: 66,
            customerId: null,
            guestAccessToken: 'tok-prior',
            checkoutIdempotencyKey: 'prior-digest',
          };
        }
        return null;
      },
    );
    mockQueryRunner.manager.createQueryBuilder = jest.fn((entity?: any) => {
      const qb: any = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn(async () => {
          if (entity?.name === 'CartEntity' || entity === undefined) {
            return {
              id: 55,
              sessionKey: 'sess-1',
              customerId: null,
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
              lastConvertedOrderId: 66,
            };
          }
          return { id: 10, number: '14040110' };
        }),
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn(),
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      };
      return qb;
    });
    mockMappedOrder({
      id: 66,
      guestAccessToken: 'tok-prior',
    });

    const order = await service.createOrderWithCityCheck(
      { customerId: null, sessionKey: 'sess-1' },
      {
        confirmationToken: confirmationForCart(),
        firstName: 'علی',
        lastName: 'تست',
        phone: '09121234567',
        address: 'خیابان تست پلاک ۱۲',
        cityId: 1,
      },
      '550e8400-e29b-41d4-a716-4466554400ff',
    );

    expect(order.id).toBe(66);
    expect(insertedOrders.length).toBe(0);
    expect(mockProductService.decrementQuantity).not.toHaveBeenCalled();
  });

  it('denies guest read without access token', async () => {
    mockOrderRepository.createQueryBuilder = jest.fn(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 5,
        number: '1',
        status: OrderStatus.pending,
        customerId: null,
        guestAccessToken: generateGuestAccessToken(),
        amount: 1,
        discount: 0,
        shipping: 0,
        tax: 0,
        finalAmount: 1,
        orderItems: [],
        city: null,
        createdAt: new Date(),
        isDeleted: false,
        firstName: null,
        lastName: null,
        phone: null,
        address: null,
        addressDetails: null,
        postalCode: null,
        cityId: null,
        description: null,
      }),
    }));

    await expect(
      service.getOwnedOrder(5, { customerId: null, sessionKey: 'other' }, null),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('denies customer read of another customer order', async () => {
    mockOrderRepository.createQueryBuilder = jest.fn(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 5,
        number: '1',
        status: OrderStatus.pending,
        customerId: 2,
        guestAccessToken: null,
        amount: 1,
        discount: 0,
        shipping: 0,
        tax: 0,
        finalAmount: 1,
        orderItems: [],
        city: null,
        createdAt: new Date(),
        isDeleted: false,
        firstName: null,
        lastName: null,
        phone: null,
        address: null,
        addressDetails: null,
        postalCode: null,
        cityId: null,
        description: null,
      }),
    }));

    await expect(
      service.getOwnedOrder(5, { customerId: 9, sessionKey: null }, null),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('confirmation unpaid order uses captured FX snapshot, not live FX', async () => {
    mockSettingService.getTryToToman.mockResolvedValue(4000);
    mockMappedOrder({
      id: 77,
      status: OrderStatus.pending,
      customerId: null,
      guestAccessToken: 'tok-a',
      amount: 100,
      finalAmount: 100,
      commercialCurrency: 'TRY',
      fxRateToIrt: 3500,
      successfulTransactionId: null,
      orderItems: [
        {
          id: 1,
          productId: 3,
          productName: 'کفش',
          optionName: null,
          optionLabel: null,
          price: 100,
          discountedPrice: 0,
          quantity: 1,
          finalAmount: 100,
        },
      ],
    });

    const order = await service.getOwnedOrder(
      77,
      { customerId: null, sessionKey: 'sess-1' },
      'tok-a',
    );

    expect(order.paymentStatus).toBe('awaiting_payment');
    expect(order.paymentStatusLabel).toBe('در انتظار پرداخت');
    expect(order.payableTotal).toBe(350000);
    expect(order.subtotal).toBe(350000);
    expect(mockSettingService.getTryToToman).not.toHaveBeenCalled();
  });

  it('confirmation paid order uses captured FX and is not awaiting_payment', async () => {
    mockSettingService.getTryToToman.mockResolvedValue(4000);
    mockMappedOrder({
      id: 77,
      status: OrderStatus.paid,
      customerId: null,
      guestAccessToken: 'tok-a',
      amount: 100,
      finalAmount: 100,
      commercialCurrency: 'TRY',
      fxRateToIrt: 3500,
      successfulTransactionId: 42,
      orderItems: [
        {
          id: 1,
          productId: 3,
          productName: 'کفش',
          optionName: null,
          optionLabel: null,
          price: 100,
          discountedPrice: 0,
          quantity: 1,
          finalAmount: 100,
        },
      ],
    });

    const order = await service.getOwnedOrder(
      77,
      { customerId: null, sessionKey: 'sess-1' },
      'tok-a',
    );

    expect(order.paymentStatus).toBe('paid');
    expect(order.paymentStatusLabel).toBe('پرداخت شده');
    expect(order.payableTotal).toBe(350000);
    expect(order.paymentStatus).not.toBe('awaiting_payment');
  });

  it('live FX change after order creation does not alter confirmation total', async () => {
    mockSettingService.getTryToToman.mockResolvedValue(9999);
    mockMappedOrder({
      id: 77,
      status: OrderStatus.pending,
      customerId: null,
      guestAccessToken: 'tok-a',
      amount: 100,
      finalAmount: 100,
      commercialCurrency: 'TRY',
      fxRateToIrt: 3500,
      successfulTransactionId: null,
      orderItems: [],
    });

    const first = await service.getOwnedOrder(
      77,
      { customerId: null, sessionKey: 'sess-1' },
      'tok-a',
    );
    mockSettingService.getTryToToman.mockResolvedValue(12000);
    const second = await service.getOwnedOrder(
      77,
      { customerId: null, sessionKey: 'sess-1' },
      'tok-a',
    );

    expect(first.payableTotal).toBe(350000);
    expect(second.payableTotal).toBe(350000);
  });
});
