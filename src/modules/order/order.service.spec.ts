const mockQueryRunner = {
  connect: jest.fn(),
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
  release: jest.fn(),
  manager: {
    save: jest.fn(),
    remove: jest.fn(),
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

import { HttpException } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderStatus } from './entities/order.entity';
import { ProductStatus } from '../product/entities/product.entity';

describe('OrderService (Phase 1A security)', () => {
  let service: OrderService;
  let mockOrderRepository: any;
  let mockOrderItemRepository: any;
  let mockError: any;
  let mockProductService: any;
  let mockAddressService: any;
  let mockSettingService: any;
  let mockCustomerService: any;
  let insertedOrderItems: any[];
  let insertedOrder: any;

  beforeEach(() => {
    insertedOrderItems = [];
    insertedOrder = null;
    mockQueryRunner.connect.mockClear();
    mockQueryRunner.startTransaction.mockClear();
    mockQueryRunner.commitTransaction.mockClear();
    mockQueryRunner.rollbackTransaction.mockClear();
    mockQueryRunner.release.mockClear();

    mockError = {
      unprocessableEntity: jest.fn((msgs) => {
        throw new HttpException({ messages: msgs }, 422);
      }),
      methodNotAllowed: jest.fn((msgs) => {
        throw new HttpException({ messages: msgs }, 405);
      }),
    };

    mockProductService = {
      findByIds: jest.fn(),
      decrementQuantity: jest.fn().mockResolvedValue(true),
      decrementAttributeQuantity: jest.fn().mockResolvedValue(true),
      incrementQuantity: jest.fn().mockResolvedValue(undefined),
      incrementAttributeQuantity: jest.fn().mockResolvedValue(undefined),
    };

    mockAddressService = {
      getRecordById: jest.fn().mockResolvedValue({
        address: 'Test St',
        location: null,
        details: null,
        postalCode: '12345',
        phone: '09120000000',
        cityId: 1,
      }),
    };

    mockSettingService = {
      getByAdmin: jest.fn().mockResolvedValue({
        taxPercent: 0,
        shippingPercent: 0,
        maxShippingCost: 0,
      }),
      requireFreshAuthoritativeTryToToman: jest.fn().mockResolvedValue({
        tryToToman: 3500,
        tryToRialRaw: 35000,
        tryToRialEffective: 35000,
        source: 'TGJU',
        fetchedAt: new Date(),
        ageMs: 0,
        isFresh: true,
        maxAgeMs: 900000,
      }),
    };

    mockCustomerService = {
      getActiveById: jest.fn().mockResolvedValue({ id: 7 }),
    };

    mockOrderRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };

    mockOrderItemRepository = {};

    mockQueryRunner.manager.remove = jest.fn();

    mockQueryRunner.manager.createQueryBuilder = jest.fn(() => ({
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn((values) => {
        if (Array.isArray(values)) {
          insertedOrderItems.push(...values);
        } else {
          insertedOrder = values;
        }
        return {
          execute: jest.fn().mockResolvedValue({ identifiers: [{ id: 99 }] }),
        };
      }),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
      getMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    }));

    const mockFinancialEventService = {
      insertIdempotent: jest.fn().mockResolvedValue('inserted'),
    };

    service = new OrderService(
      mockOrderRepository,
      mockOrderItemRepository,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      mockProductService,
      mockError,
      mockCustomerService,
      mockAddressService,
      mockSettingService,
      {} as any,
      mockFinancialEventService as any,
    );

    jest
      .spyOn(service as any, '_generateOrderNumber')
      .mockResolvedValue('1401011');
  });

  it('ignores client-supplied product price for customer orders', async () => {
    mockProductService.findByIds.mockResolvedValue([
      {
        id: 1,
        price: 50000,
        discountedPrice: 45000,
        quantity: 10,
        status: ProductStatus.active,
        isDeleted: false,
        productAttributeValues: [],
      },
    ]);

    await service.addUpdate(
      {
        productItems: [{ productId: 1, quantity: 2, price: 1 }],
        addressId: 1,
        firstName: 'Ali',
        lastName: 'Test',
      },
      42,
    );

    expect(insertedOrderItems[0].price).toBe(50000);
    expect(insertedOrderItems[0].discountedPrice).toBe(45000);
    expect(insertedOrder.commercialCurrency).toBe('TRY');
    expect(insertedOrder.fxRateToIrt).toBe(3500);
    expect(insertedOrderItems[0].cogsStatus).toBe('missing');
    expect(insertedOrderItems[0].unitLandedCostSnapshot).toBeNull();
  });

  it('uses client-supplied price only for admin orders', async () => {
    mockProductService.findByIds.mockResolvedValue([
      {
        id: 1,
        price: 50000,
        discountedPrice: 45000,
        quantity: 10,
        status: ProductStatus.active,
        isDeleted: false,
        productAttributeValues: [],
      },
    ]);

    await service.addUpdate(
      {
        customerId: 7,
        productItems: [{ productId: 1, quantity: 1, price: 1000 }],
        addressId: 1,
        status: OrderStatus.pending,
      },
      null,
    );

    expect(insertedOrderItems[0].price).toBe(1000);
    expect(insertedOrderItems[0].discountedPrice).toBe(0);
  });

  it('ignores client-supplied shipping for customer orders', async () => {
    mockProductService.findByIds.mockResolvedValue([
      {
        id: 1,
        price: 10000,
        discountedPrice: null,
        quantity: -1,
        status: ProductStatus.active,
        isDeleted: false,
        productAttributeValues: [],
      },
    ]);

    mockSettingService.getByAdmin.mockResolvedValue({
      taxPercent: 0,
      shippingPercent: 10,
      maxShippingCost: 5000,
    });

    await service.addUpdate(
      {
        productItems: [{ productId: 1, quantity: 1 }],
        addressId: 1,
        firstName: 'Ali',
        lastName: 'Test',
        shipping: 99999,
      },
      42,
    );

    expect(insertedOrder).toBeTruthy();
    expect(insertedOrder.shipping).not.toBe(99999);
    // 10% of 10000 = 1000, capped at maxShippingCost 5000 → 1000 TRY
    expect(insertedOrder.shipping).toBe(1000);
    expect(mockSettingService.getByAdmin).toHaveBeenCalled();
  });

  it('applies maxShippingCost cap in TRY for customer orders', async () => {
    mockProductService.findByIds.mockResolvedValue([
      {
        id: 1,
        price: 100000,
        discountedPrice: null,
        quantity: -1,
        status: ProductStatus.active,
        isDeleted: false,
        productAttributeValues: [],
      },
    ]);

    mockSettingService.getByAdmin.mockResolvedValue({
      taxPercent: 0,
      shippingPercent: 10,
      maxShippingCost: 500,
    });

    await service.addUpdate(
      {
        productItems: [{ productId: 1, quantity: 1 }],
        addressId: 1,
        firstName: 'Ali',
        lastName: 'Test',
      },
      42,
    );

    // 10% of 100000 = 10000, capped at 500 TRY
    expect(insertedOrder.shipping).toBe(500);
  });

  it('leaves shipping uncapped when maxShippingCost is 0', async () => {
    mockProductService.findByIds.mockResolvedValue([
      {
        id: 1,
        price: 10000,
        discountedPrice: null,
        quantity: -1,
        status: ProductStatus.active,
        isDeleted: false,
        productAttributeValues: [],
      },
    ]);

    mockSettingService.getByAdmin.mockResolvedValue({
      taxPercent: 0,
      shippingPercent: 10,
      maxShippingCost: 0,
    });

    await service.addUpdate(
      {
        productItems: [{ productId: 1, quantity: 1 }],
        addressId: 1,
        firstName: 'Ali',
        lastName: 'Test',
      },
      42,
    );

    expect(insertedOrder.shipping).toBe(1000);
  });

  it('scopes getRecordById to customer when customerId is provided', async () => {
    mockOrderRepository.findOne.mockResolvedValue(null);

    const result = await service.getRecordById(5, null, 42);

    expect(mockOrderRepository.findOne).toHaveBeenCalledWith({
      where: { id: 5, customerId: 42 },
    });
    expect(result).toBeNull();
  });

  it('settleOrderManuallyAtomic uses finalization invariant', async () => {
    const settleSpy = jest
      .spyOn(service, 'settleOrderManuallyAtomic')
      .mockResolvedValue('finalized');

    const result = await service.settleOrderManuallyAtomic(1);

    expect(settleSpy).toHaveBeenCalledWith(1);
    expect(result).toBe('finalized');
  });

  it('_deleteItemsAndRollbackQuantity uses transactional increment helpers', async () => {
    mockProductService.incrementQuantity = jest
      .fn()
      .mockResolvedValue(undefined);
    mockProductService.incrementAttributeQuantity = jest
      .fn()
      .mockResolvedValue(undefined);

    const orderItem = {
      id: 1,
      quantity: 2,
      productId: 5,
      productAttributeValueId: null,
      product: { id: 5 },
    } as any;

    await (service as any)._deleteItemsAndRollbackQuantity(
      [orderItem],
      mockQueryRunner,
    );

    expect(mockProductService.incrementQuantity).toHaveBeenCalledWith(
      5,
      2,
      mockQueryRunner,
    );
    expect(mockQueryRunner.manager.remove).toHaveBeenCalledWith(orderItem);
  });

  it('_deleteItemsAndRollbackQuantity restores PAV for variant lines', async () => {
    mockProductService.incrementQuantity = jest
      .fn()
      .mockResolvedValue(undefined);
    mockProductService.incrementAttributeQuantity = jest
      .fn()
      .mockResolvedValue(undefined);

    const orderItem = {
      id: 2,
      quantity: 3,
      productId: 5,
      productAttributeValueId: 77,
    } as any;

    await (service as any)._deleteItemsAndRollbackQuantity(
      [orderItem],
      mockQueryRunner,
    );

    expect(mockProductService.incrementAttributeQuantity).toHaveBeenCalledWith(
      77,
      3,
      mockQueryRunner,
    );
    expect(mockProductService.incrementQuantity).not.toHaveBeenCalled();
  });

  it('rejects invalid variant id instead of falling back to base product', async () => {
    mockProductService.findByIds.mockResolvedValue([
      {
        id: 1,
        price: 50000,
        discountedPrice: 0,
        quantity: 10,
        status: ProductStatus.active,
        isDeleted: false,
        productAttributeValues: [{ id: 99, price: 1000, isDeleted: false }],
      },
    ]);

    await expect(
      service.addUpdate(
        {
          productItems: [
            { productId: 1, quantity: 1, productAttributeValueId: 555 },
          ],
          addressId: 1,
          firstName: 'Ali',
          lastName: 'Test',
        },
        42,
      ),
    ).rejects.toThrow(HttpException);
  });

  it('rejects soft-deleted variant even if id were present in payload', async () => {
    mockProductService.findByIds.mockResolvedValue([
      {
        id: 1,
        price: 50000,
        discountedPrice: 0,
        quantity: 10,
        status: ProductStatus.active,
        isDeleted: false,
        productAttributeValues: [{ id: 99, price: 1000, isDeleted: true }],
      },
    ]);

    await expect(
      service.addUpdate(
        {
          productItems: [
            { productId: 1, quantity: 1, productAttributeValueId: 99 },
          ],
          addressId: 1,
          firstName: 'Ali',
          lastName: 'Test',
        },
        42,
      ),
    ).rejects.toThrow(HttpException);
  });

  it('rolls back transaction when stock decrement fails', async () => {
    mockProductService.findByIds.mockResolvedValue([
      {
        id: 1,
        price: 1000,
        discountedPrice: null,
        quantity: 1,
        status: ProductStatus.active,
        isDeleted: false,
        productAttributeValues: [],
      },
    ]);

    mockProductService.decrementQuantity.mockResolvedValue(false);

    await expect(
      service.addUpdate(
        {
          productItems: [{ productId: 1, quantity: 5 }],
          addressId: 1,
          firstName: 'Ali',
          lastName: 'Test',
        },
        42,
      ),
    ).rejects.toThrow(HttpException);

    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
  });

  it('preserves existing Order FX snapshot on unpaid rewrite when live FX changes', async () => {
    const capturedAt = new Date('2026-01-01T00:00:00.000Z');
    const existingOrder: any = {
      id: 55,
      customerId: 42,
      status: OrderStatus.pending,
      commercialCurrency: 'TRY',
      fxRateToIrt: 3500,
      fxCapturedAt: capturedAt,
      fxRateSource: 'TGJU',
      amount: 100,
      discount: 0,
      shipping: 0,
      tax: 0,
      finalAmount: 100,
    };

    mockSettingService.requireFreshAuthoritativeTryToToman.mockResolvedValue({
      tryToToman: 4000,
      source: 'TGJU',
      fetchedAt: new Date(),
      ageMs: 0,
      isFresh: true,
      maxAgeMs: 900000,
    });

    mockProductService.findByIds.mockResolvedValue([
      {
        id: 1,
        price: 100,
        discountedPrice: null,
        quantity: 10,
        status: ProductStatus.active,
        isDeleted: false,
        productAttributeValues: [],
      },
    ]);

    mockQueryRunner.manager.findOne = jest
      .fn()
      .mockResolvedValueOnce(existingOrder)
      .mockResolvedValueOnce(null);
    mockQueryRunner.manager.find = jest.fn().mockResolvedValue([]);
    mockQueryRunner.manager.save = jest.fn(async (o) => o);
    jest
      .spyOn(service as any, 'lockOrderTransactions')
      .mockResolvedValue([]);
    jest
      .spyOn(service as any, '_deleteItemsAndRollbackQuantity')
      .mockResolvedValue(undefined);

    await service.addUpdate(
      {
        productItems: [{ productId: 1, quantity: 1 }],
        addressId: 1,
        firstName: 'Ali',
        lastName: 'Test',
      },
      42,
      55,
    );

    expect(
      mockSettingService.requireFreshAuthoritativeTryToToman,
    ).not.toHaveBeenCalled();
    expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 55,
        finalAmount: 100,
        commercialCurrency: 'TRY',
        fxRateToIrt: 3500,
        fxCapturedAt: capturedAt,
        fxRateSource: 'TGJU',
      }),
    );
  });

  it('does not fabricate FX on rewrite of legacy order with null FX snapshot', async () => {
    const existingOrder: any = {
      id: 56,
      customerId: 42,
      status: OrderStatus.pending,
      commercialCurrency: null,
      fxRateToIrt: null,
      fxCapturedAt: null,
      fxRateSource: null,
      amount: 100,
      discount: 0,
      shipping: 0,
      tax: 0,
      finalAmount: 100,
    };

    mockSettingService.requireFreshAuthoritativeTryToToman.mockResolvedValue({
      tryToToman: 4000,
      source: 'TGJU',
      fetchedAt: new Date(),
      ageMs: 0,
      isFresh: true,
      maxAgeMs: 900000,
    });

    mockProductService.findByIds.mockResolvedValue([
      {
        id: 1,
        price: 100,
        discountedPrice: null,
        quantity: 10,
        status: ProductStatus.active,
        isDeleted: false,
        productAttributeValues: [],
      },
    ]);

    mockQueryRunner.manager.findOne = jest
      .fn()
      .mockResolvedValueOnce(existingOrder)
      .mockResolvedValueOnce(null);
    mockQueryRunner.manager.find = jest.fn().mockResolvedValue([]);
    mockQueryRunner.manager.save = jest.fn(async (o) => o);
    jest
      .spyOn(service as any, 'lockOrderTransactions')
      .mockResolvedValue([]);
    jest
      .spyOn(service as any, '_deleteItemsAndRollbackQuantity')
      .mockResolvedValue(undefined);

    await service.addUpdate(
      {
        productItems: [{ productId: 1, quantity: 1 }],
        addressId: 1,
        firstName: 'Ali',
        lastName: 'Test',
      },
      42,
      56,
    );

    expect(
      mockSettingService.requireFreshAuthoritativeTryToToman,
    ).not.toHaveBeenCalled();
    expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 56,
        fxRateToIrt: null,
        fxCapturedAt: null,
        fxRateSource: null,
        commercialCurrency: null,
      }),
    );
  });
});
