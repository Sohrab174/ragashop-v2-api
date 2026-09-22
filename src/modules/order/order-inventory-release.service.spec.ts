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
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderPaymentFinalizationEntity } from './entities/order-payment-finalization.entity';
import {
  TransactionEntity,
  TransactionStatus,
} from '../transaction/entities/transaction.entity';

describe('OrderService Phase C1 unpaid inventory safety', () => {
  let service: OrderService;
  let mockOrderRepository: any;
  let mockProductService: any;
  let mockError: any;
  let quantities: Record<string, number>;

  beforeEach(() => {
    quantities = {
      'product:10': 10,
      'pav:55': 8,
      'product:20': 5,
    };

    mockQueryRunner.connect.mockClear();
    mockQueryRunner.startTransaction.mockClear();
    mockQueryRunner.commitTransaction.mockClear();
    mockQueryRunner.rollbackTransaction.mockClear();
    mockQueryRunner.release.mockClear();
    mockQueryRunner.manager.save = jest.fn(async (entity) => entity);
    mockQueryRunner.manager.remove = jest.fn();
    mockQueryRunner.manager.findOne = jest.fn();
    mockQueryRunner.manager.find = jest.fn().mockResolvedValue([]);
    mockQueryRunner.manager.createQueryBuilder = jest.fn();

    mockError = {
      unprocessableEntity: jest.fn((msgs) => {
        throw new HttpException({ messages: msgs }, 422);
      }),
      methodNotAllowed: jest.fn((msgs) => {
        throw new HttpException({ messages: msgs }, 405);
      }),
    };

    mockProductService = {
      incrementQuantity: jest.fn(async (id, qty) => {
        const key = `product:${id}`;
        if (quantities[key] === -1) return;
        quantities[key] += qty;
      }),
      incrementAttributeQuantity: jest.fn(async (id, qty) => {
        const key = `pav:${id}`;
        if (quantities[key] === -1) return;
        quantities[key] += qty;
      }),
      decrementQuantity: jest.fn(),
      decrementAttributeQuantity: jest.fn(),
    };

    mockOrderRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const mockSettingService = {
      getByAdmin: jest.fn().mockResolvedValue({
        taxPercent: 0,
        shippingPercent: 0,
        maxShippingCost: 0,
      }),
      requireFreshAuthoritativeTryToToman: jest.fn().mockResolvedValue({
        tryToToman: 3500,
        source: 'TGJU',
        fetchedAt: new Date(),
        isFresh: true,
      }),
    };

    const mockAddressService = {
      getRecordById: jest.fn().mockResolvedValue({
        address: 'a',
        location: null,
        details: null,
        postalCode: '1',
        phone: '0912',
        cityId: 1,
      }),
    };

    mockProductService.findByIds = jest.fn().mockResolvedValue([
      {
        id: 10,
        price: 100,
        discountedPrice: null,
        quantity: 10,
        status: 'active',
        isDeleted: false,
        productAttributeValues: [],
      },
    ]);

    service = new OrderService(
      mockOrderRepository,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      mockProductService,
      mockError,
      { getActiveById: jest.fn().mockResolvedValue({ id: 7 }) } as any,
      mockAddressService as any,
      mockSettingService as any,
      {} as any,
      { insertIdempotent: jest.fn() } as any,
    );
  });

  function pendingOrder(overrides: Partial<any> = {}) {
    return {
      id: 1,
      status: OrderStatus.pending,
      successfulTransactionId: null,
      finalAmount: 1000,
      reasonRejected: null,
      postTrackingCode: null,
      sourceTrackingCode: null,
      createdAt: new Date('2020-01-01T00:00:00Z'),
      orderItems: [
        {
          id: 101,
          productId: 10,
          productAttributeValueId: null,
          quantity: 2,
        },
      ],
      transactions: [],
      ...overrides,
    };
  }

  /** Stub lock findOne + tx lock QB + item finds (C1 lock-first pattern). */
  function stubLockedOrder(order: any, finalization: any = null) {
    mockQueryRunner.manager.findOne.mockImplementation(async (entity: any) => {
      if (entity === OrderPaymentFinalizationEntity) {
        return finalization;
      }
      return order;
    });
    mockQueryRunner.manager.find.mockImplementation(async (entity: any) => {
      if (entity === TransactionEntity) {
        return order.transactions || [];
      }
      if (entity === OrderItemEntity) {
        return order.orderItems || [];
      }
      return [];
    });
    mockQueryRunner.manager.createQueryBuilder.mockImplementation(
      (entity?: any) => {
        if (entity === TransactionEntity) {
          return {
            setLock: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            getMany: jest
              .fn()
              .mockResolvedValue(order.transactions || []),
          };
        }
        // PaymentSubmissionEntity hold check (C2A) — default: no active hold
        return {
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(null),
          getMany: jest.fn().mockResolvedValue([]),
          execute: jest.fn().mockResolvedValue({ affected: 0 }),
        };
      },
    );
  }

  function stubCleanupPages(
    pages: Array<Array<{ id: number; createdAt: Date }>>,
    capture?: { andWheres: string[] },
  ) {
    let call = 0;
    mockOrderRepository.createQueryBuilder.mockImplementation(() => {
      const page = pages[call] || [];
      call += 1;
      return {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn(function (sql: any) {
          if (capture) {
            capture.andWheres.push(String(sql));
          }
          return this;
        }),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(page),
      };
    });
  }

  describe('A/B/J — plain, PAV, mixed restore on delete', () => {
    it('A. restores plain product quantity on unpaid delete', async () => {
      const order = pendingOrder();
      stubLockedOrder(order);
      quantities['product:10'] = 8;

      await service.delete(1);

      expect(mockProductService.incrementQuantity).toHaveBeenCalledWith(
        10,
        2,
        mockQueryRunner,
      );
      expect(
        mockProductService.incrementAttributeQuantity,
      ).not.toHaveBeenCalled();
      expect(quantities['product:10']).toBe(10);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('B. restores PAV bucket only for variant lines', async () => {
      const order = pendingOrder({
        orderItems: [
          {
            id: 102,
            productId: 10,
            productAttributeValueId: 55,
            quantity: 3,
          },
        ],
      });
      stubLockedOrder(order);
      quantities['pav:55'] = 5;

      await service.delete(1);

      expect(mockProductService.incrementAttributeQuantity).toHaveBeenCalledWith(
        55,
        3,
        mockQueryRunner,
      );
      expect(mockProductService.incrementQuantity).not.toHaveBeenCalled();
      expect(quantities['pav:55']).toBe(8);
    });

    it('J. mixed cart restores each bucket atomically', async () => {
      const order = pendingOrder({
        orderItems: [
          {
            id: 1,
            productId: 10,
            productAttributeValueId: null,
            quantity: 2,
          },
          {
            id: 2,
            productId: 20,
            productAttributeValueId: 55,
            quantity: 1,
          },
        ],
      });
      stubLockedOrder(order);
      quantities['product:10'] = 8;
      quantities['pav:55'] = 7;
      quantities['product:20'] = 5;

      await service.delete(1);

      expect(mockProductService.incrementQuantity).toHaveBeenCalledWith(
        10,
        2,
        mockQueryRunner,
      );
      expect(mockProductService.incrementAttributeQuantity).toHaveBeenCalledWith(
        55,
        1,
        mockQueryRunner,
      );
      expect(quantities['product:10']).toBe(10);
      expect(quantities['pav:55']).toBe(8);
      expect(quantities['product:20']).toBe(5);
    });
  });

  describe('C — retry / double release', () => {
    it('second tryReleasePendingInventory is no-op after durable reject', async () => {
      const order = pendingOrder();
      stubLockedOrder(order);
      quantities['product:10'] = 8;

      const first = await service.tryReleasePendingInventory(
        1,
        mockQueryRunner as any,
      );
      expect(first).toBe('released');
      expect(order.status).toBe(OrderStatus.rejected);

      const second = await service.tryReleasePendingInventory(
        1,
        mockQueryRunner as any,
      );

      expect(second).toBe('skipped_not_reserved');
      expect(mockProductService.incrementQuantity).toHaveBeenCalledTimes(1);
    });

    it('delete of already-rejected order does not restore again', async () => {
      stubLockedOrder(pendingOrder({ status: OrderStatus.rejected }));

      await service.delete(1);

      expect(mockProductService.incrementQuantity).not.toHaveBeenCalled();
      expect(
        mockProductService.incrementAttributeQuantity,
      ).not.toHaveBeenCalled();
      expect(mockQueryRunner.manager.remove).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });
  });

  describe('D — admin reject + lifecycle', () => {
    it('pending unpaid reject restores inventory once and sets rejected', async () => {
      const order = pendingOrder();
      stubLockedOrder(order);
      quantities['product:10'] = 8;

      await service.updateStatus({
        id: 1,
        status: OrderStatus.rejected,
        reasonRejected: 'out of stock at source',
      } as any);

      expect(mockProductService.incrementQuantity).toHaveBeenCalledWith(
        10,
        2,
        mockQueryRunner,
      );
      expect(order.status).toBe(OrderStatus.rejected);
      expect(order.reasonRejected).toBe('out of stock at source');
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('reject of already-rejected order does not restore again', async () => {
      stubLockedOrder(pendingOrder({ status: OrderStatus.rejected }));

      await service.updateStatus({
        id: 1,
        status: OrderStatus.rejected,
      } as any);

      expect(mockProductService.incrementQuantity).not.toHaveBeenCalled();
    });

    it('reject of paid order does not restore inventory', async () => {
      const order = pendingOrder({ status: OrderStatus.paid });
      stubLockedOrder(order);

      await service.updateStatus({
        id: 1,
        status: OrderStatus.rejected,
      } as any);

      expect(mockProductService.incrementQuantity).not.toHaveBeenCalled();
      expect(order.status).toBe(OrderStatus.rejected);
    });

    it('ABA: rejected → pending is blocked', async () => {
      stubLockedOrder(pendingOrder({ status: OrderStatus.rejected }));

      await expect(
        service.updateStatus({
          id: 1,
          status: OrderStatus.pending,
        } as any),
      ).rejects.toBeInstanceOf(HttpException);
      expect(mockProductService.incrementQuantity).not.toHaveBeenCalled();
    });

    it('paid → pending is blocked', async () => {
      stubLockedOrder(pendingOrder({ status: OrderStatus.paid }));

      await expect(
        service.updateStatus({
          id: 1,
          status: OrderStatus.pending,
        } as any),
      ).rejects.toBeInstanceOf(HttpException);
    });

    it('unpaid pending → accepted is blocked', async () => {
      stubLockedOrder(pendingOrder());

      await expect(
        service.updateStatus({
          id: 1,
          status: OrderStatus.accepted,
        } as any),
      ).rejects.toBeInstanceOf(HttpException);
      expect(mockProductService.incrementQuantity).not.toHaveBeenCalled();
    });
  });

  describe('E — delete', () => {
    it('blocks delete of paid order and does not restore', async () => {
      stubLockedOrder(
        pendingOrder({
          status: OrderStatus.paid,
          successfulTransactionId: 9,
        }),
      );

      await expect(service.delete(1)).rejects.toBeInstanceOf(HttpException);
      expect(mockProductService.incrementQuantity).not.toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('F/G — cleanup + starvation', () => {
    it('F. cleanup deletes expired pending and restores inventory', async () => {
      stubCleanupPages([
        [{ id: 1, createdAt: new Date('2020-01-01') }],
      ]);
      stubLockedOrder(pendingOrder());
      quantities['product:10'] = 8;

      const deleteSpy = jest.spyOn(service, 'delete');
      const result = await service.handleDeleteUnpaid();

      expect(deleteSpy).toHaveBeenCalledWith(1);
      expect(result.released).toBe(1);
      expect(result.failed).toBe(0);
      expect(quantities['product:10']).toBe(10);
    });

    it('F. empty candidate set yields zero processed', async () => {
      stubCleanupPages([[]]);

      const result = await service.handleDeleteUnpaid();

      expect(result.processed).toBe(0);
      expect(mockOrderRepository.createQueryBuilder).toHaveBeenCalled();
    });

    it('G. repeated cleanup does not double-restore', async () => {
      stubCleanupPages([
        [{ id: 1, createdAt: new Date('2020-01-01') }],
        [],
      ]);

      stubLockedOrder(pendingOrder());
      quantities['product:10'] = 8;

      await service.handleDeleteUnpaid();
      const second = await service.handleDeleteUnpaid();

      expect(mockProductService.incrementQuantity).toHaveBeenCalledTimes(1);
      expect(second.processed).toBe(0);
      expect(quantities['product:10']).toBe(10);
    });

    it('one failing order does not stop others', async () => {
      stubCleanupPages([
        [
          { id: 1, createdAt: new Date('2020-01-01') },
          { id: 2, createdAt: new Date('2020-01-02') },
        ],
      ]);
      jest
        .spyOn(service, 'delete')
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(true);

      const result = await service.handleDeleteUnpaid();

      expect(result.processed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.released).toBe(1);
    });

    it('starvation: progresses past protected oldest to release eligible later', async () => {
      const protectedId = 1;
      const eligibleId = 2;
      stubCleanupPages([
        [
          { id: protectedId, createdAt: new Date('2020-01-01') },
          { id: eligibleId, createdAt: new Date('2020-01-02') },
        ],
      ]);

      jest.spyOn(service, 'delete').mockImplementation(async (id: number) => {
        if (id === protectedId) {
          throw new HttpException({ messages: ['financial'] }, 405);
        }
        return true;
      });

      const result = await service.handleDeleteUnpaid();

      expect(result.processed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.released).toBe(1);
      expect(service.delete).toHaveBeenCalledWith(eligibleId);
    });

    it('candidate query excludes financial preservation evidence', async () => {
      const capture = { andWheres: [] as string[] };
      stubCleanupPages([[]], capture);

      await service.handleDeleteUnpaid();

      const joined = capture.andWheres.join('\n');
      expect(joined).toContain('successfulTransactionId IS NULL');
      expect(joined).toContain('order_payment_finalization');
      expect(joined).toContain('transaction t');
      expect(joined).toContain('paidAt');
      expect(joined).toContain('payment_submission ps');
      expect(joined).toContain('SUBMITTED');
      expect(joined).toContain('holdExpiresAt');
    });

    it('cross-run: protected prefix cannot starve later eligible (SQL-filtered)', async () => {
      // Simulates production SQL that never returns protected 1..10; each cron
      // run only sees the next eligible row even with batchSize semantics.
      const deleteSpy = jest
        .spyOn(service, 'delete')
        .mockResolvedValue(true);

      stubCleanupPages([
        [{ id: 11, createdAt: new Date('2020-01-11') }],
        [],
      ]);
      const first = await service.handleDeleteUnpaid();
      expect(first.released).toBe(1);
      expect(deleteSpy).toHaveBeenCalledWith(11);

      stubCleanupPages([
        [{ id: 12, createdAt: new Date('2020-01-12') }],
        [],
      ]);
      const second = await service.handleDeleteUnpaid();
      expect(second.released).toBe(1);
      expect(deleteSpy).toHaveBeenCalledWith(12);
    });
  });

  describe('H/I — payment races', () => {
    it('H. after payment marks paid, release is skipped (no paid+restored)', async () => {
      stubLockedOrder(pendingOrder({ status: OrderStatus.paid }));

      const outcome = await service.tryReleasePendingInventory(
        1,
        mockQueryRunner as any,
      );

      expect(outcome).toBe('skipped_not_reserved');
      expect(mockProductService.incrementQuantity).not.toHaveBeenCalled();
    });

    it('H. markOrderPaidAtomic only succeeds from pending', async () => {
      mockQueryRunner.manager.createQueryBuilder = jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      }));
      mockQueryRunner.manager.findOne.mockResolvedValue({
        id: 1,
        status: OrderStatus.rejected,
      });

      const result = await service.markOrderPaidAtomic(
        1,
        mockQueryRunner as any,
      );
      expect(result).toBe('invalid_state');
    });

    it('I. reject after paid does not restore', async () => {
      stubLockedOrder(pendingOrder({ status: OrderStatus.paid }));

      await service.updateStatus({
        id: 1,
        status: OrderStatus.rejected,
      } as any);

      expect(mockProductService.incrementQuantity).not.toHaveBeenCalled();
    });

    it('I. release then mark paid fails (unpaid terminal wins)', async () => {
      const order = pendingOrder();
      stubLockedOrder(order);
      mockQueryRunner.manager.createQueryBuilder.mockImplementation(
        (entity?: any) => {
          if (entity === TransactionEntity) {
            return {
              setLock: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([]),
            };
          }
          return {
            update: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            getOne: jest.fn().mockResolvedValue(null),
            execute: jest.fn().mockResolvedValue({ affected: 0 }),
          };
        },
      );

      const release = await service.tryReleasePendingInventory(
        1,
        mockQueryRunner as any,
      );
      expect(release).toBe('released');
      expect(order.status).toBe(OrderStatus.rejected);

      const paid = await service.markOrderPaidAtomic(1, mockQueryRunner as any);
      expect(paid).toBe('invalid_state');
      expect(mockProductService.incrementQuantity).toHaveBeenCalledTimes(1);
    });
  });

  describe('verification / financial preservation vs release', () => {
    it('verification_started blocks reject restore', async () => {
      stubLockedOrder(
        pendingOrder({
          transactions: [
            {
              id: 1,
              status: TransactionStatus.verification_started,
              paidAt: null,
            },
          ],
        }),
      );

      await expect(
        service.updateStatus({
          id: 1,
          status: OrderStatus.rejected,
        } as any),
      ).rejects.toBeInstanceOf(HttpException);
      expect(mockProductService.incrementQuantity).not.toHaveBeenCalled();
    });

    it('verification_uncertain blocks delete', async () => {
      stubLockedOrder(
        pendingOrder({
          transactions: [
            {
              id: 1,
              status: TransactionStatus.verification_uncertain,
              paidAt: null,
            },
          ],
        }),
      );

      await expect(service.delete(1)).rejects.toBeInstanceOf(HttpException);
      expect(mockProductService.incrementQuantity).not.toHaveBeenCalled();
    });

    it('tryRelease skips when financially preserved', async () => {
      stubLockedOrder(
        pendingOrder({
          transactions: [
            {
              id: 1,
              status: TransactionStatus.verification_started,
              paidAt: null,
            },
          ],
        }),
      );

      const outcome = await service.tryReleasePendingInventory(
        1,
        mockQueryRunner as any,
      );
      expect(outcome).toBe('skipped_financially_preserved');
      expect(mockProductService.incrementQuantity).not.toHaveBeenCalled();
    });

    it('payment finalization claim blocks release', async () => {
      stubLockedOrder(pendingOrder(), { orderId: 1, transactionId: 9 });

      const outcome = await service.tryReleasePendingInventory(
        1,
        mockQueryRunner as any,
      );
      expect(outcome).toBe('skipped_financially_preserved');
    });
  });

  describe('K — failure atomicity', () => {
    it('rolls back delete when a line restore throws', async () => {
      stubLockedOrder(
        pendingOrder({
          orderItems: [
            {
              id: 1,
              productId: 10,
              productAttributeValueId: null,
              quantity: 1,
            },
            {
              id: 2,
              productId: 20,
              productAttributeValueId: null,
              quantity: 1,
            },
          ],
        }),
      );
      mockProductService.incrementQuantity
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('restore failed'));

      await expect(service.delete(1)).rejects.toBeInstanceOf(HttpException);
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.manager.remove).not.toHaveBeenCalled();
    });

    it('rolls back reject when restore fails', async () => {
      stubLockedOrder(pendingOrder());
      mockProductService.incrementQuantity.mockRejectedValue(
        new Error('restore failed'),
      );

      await expect(
        service.updateStatus({
          id: 1,
          status: OrderStatus.rejected,
        } as any),
      ).rejects.toBeInstanceOf(HttpException);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
    });
  });

  describe('preserved transactions block unpaid delete', () => {
    it('does not restore when deletion is financially blocked', async () => {
      stubLockedOrder(
        pendingOrder({
          transactions: [
            {
              id: 1,
              status: TransactionStatus.verification_uncertain,
              paidAt: null,
            },
          ],
        }),
      );

      await expect(service.delete(1)).rejects.toBeInstanceOf(HttpException);
      expect(mockProductService.incrementQuantity).not.toHaveBeenCalled();
    });
  });

  describe('admin rewrite reservation ownership', () => {
    function stubRewritePath(order: any) {
      stubLockedOrder(order);
      mockProductService.findByIds = jest.fn().mockResolvedValue([
        {
          id: 10,
          price: 1000,
          discountedPrice: null,
          quantity: 10,
          status: 'active',
          isDeleted: false,
          productAttributeValues: [],
        },
      ]);
      (service as any).addressService = {
        getRecordById: jest.fn().mockResolvedValue({
          address: 'a',
          location: null,
          details: null,
          postalCode: '1',
          phone: '1',
          cityId: 1,
        }),
      };
      (service as any).settingService = {
        getByAdmin: jest.fn().mockResolvedValue({
          taxPercent: 0,
          shippingPercent: 0,
          maxShippingCost: 0,
        }),
        requireFreshAuthoritativeTryToToman: jest.fn().mockResolvedValue({
          tryToToman: 3500,
          source: 'TGJU',
          fetchedAt: new Date(),
          isFresh: true,
        }),
      };
      (service as any).customerService = {
        getActiveById: jest.fn().mockResolvedValue({ id: 7 }),
      };
      mockQueryRunner.manager.createQueryBuilder.mockImplementation(
        (entity?: any) => {
          if (entity === TransactionEntity) {
            return {
              setLock: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              getMany: jest
                .fn()
                .mockResolvedValue(order.transactions || []),
            };
          }
          return {
            insert: jest.fn().mockReturnThis(),
            into: jest.fn().mockReturnThis(),
            values: jest.fn().mockReturnValue({
              execute: jest
                .fn()
                .mockResolvedValue({ identifiers: [{ id: 1 }] }),
            }),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            getOne: jest.fn().mockResolvedValue(null),
            getMany: jest.fn().mockResolvedValue([]),
          };
        },
      );
      mockProductService.decrementQuantity = jest.fn().mockResolvedValue(true);
    }

    it('rejects rewrite of paid order without restoring', async () => {
      stubRewritePath(pendingOrder({ status: OrderStatus.paid }));

      await expect(
        service.addUpdate(
          {
            id: 1,
            customerId: 7,
            productItems: [{ productId: 10, quantity: 1 }],
            addressId: 1,
            status: OrderStatus.pending,
          },
          null,
          1,
        ),
      ).rejects.toBeInstanceOf(HttpException);
      expect(mockProductService.incrementQuantity).not.toHaveBeenCalled();
    });

    it('rejects rewrite of rejected order without double restore', async () => {
      stubRewritePath(pendingOrder({ status: OrderStatus.rejected }));

      await expect(
        service.addUpdate(
          {
            id: 1,
            customerId: 7,
            productItems: [{ productId: 10, quantity: 1 }],
            addressId: 1,
            status: OrderStatus.pending,
          },
          null,
          1,
        ),
      ).rejects.toBeInstanceOf(HttpException);
      expect(mockProductService.incrementQuantity).not.toHaveBeenCalled();
    });

    it('rejects rewrite while verification_started', async () => {
      stubRewritePath(
        pendingOrder({
          transactions: [
            {
              id: 1,
              status: TransactionStatus.verification_started,
              paidAt: null,
            },
          ],
        }),
      );

      await expect(
        service.addUpdate(
          {
            id: 1,
            customerId: 7,
            productItems: [{ productId: 10, quantity: 1 }],
            addressId: 1,
            status: OrderStatus.pending,
          },
          null,
          1,
        ),
      ).rejects.toBeInstanceOf(HttpException);
      expect(mockProductService.incrementQuantity).not.toHaveBeenCalled();
    });
  });
});
