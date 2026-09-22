const findOneCalls: Array<{ entity: any; options: any }> = [];

const mockQueryRunner = {
  connect: jest.fn(),
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
  release: jest.fn(),
  manager: {
    findOne: jest.fn(async (entity, options) => {
      findOneCalls.push({ entity, options });
      return mockFindOneImpl(entity, options);
    }),
    save: jest.fn(async (e) => e),
    createQueryBuilder: jest.fn(() => mockQb),
  },
};

let mockFindOneImpl: (entity: any, options: any) => any = () => null;
let mockQb: any;

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
import { PaymentSubmissionService } from './payment-submission.service';
import { OrderEntity } from '../order/entities/order.entity';
import { OrderStatus } from '../order/entities/order.entity';
import { PaymentSubmissionEntity } from './entities/payment-submission.entity';
import {
  ManualPaymentRail,
  PaymentSubmissionStatus,
  resolveTimingHours,
} from './manual-payment.types';
import { OrderPaymentFinalizationEntity } from '../order/entities/order-payment-finalization.entity';

describe('PaymentSubmissionService (C2A fix pass)', () => {
  let service: PaymentSubmissionService;
  let submissionRepository: any;
  let evidenceRepository: any;
  let reviewEventRepository: any;
  let orderRepository: any;
  let settingRepository: any;
  let bankDestinationService: any;
  let methodService: any;
  let receiptStorage: any;
  let capabilityService: any;
  let orderService: any;
  let error: any;

  const eligibleOrder = {
    id: 10,
    customerId: 5,
    status: OrderStatus.pending,
    createdAt: new Date(),
    finalAmount: 100,
    commercialCurrency: 'TRY',
    fxRateToIrt: 3500,
    successfulTransactionId: null,
  };

  const destination = {
    id: 1,
    enabled: true,
    bankName: 'Melli',
    accountHolderName: 'Shop',
    cardNumber: '6219861034529007',
    iban: 'IR850123456789012345678901',
    accountNumber: null,
    allowedRails: [ManualPaymentRail.CARD_TO_CARD],
    minAmountIrt: null,
    maxAmountIrt: null,
  };

  const method = {
    enabled: true,
    rail: ManualPaymentRail.CARD_TO_CARD,
    minAmountIrt: null,
    maxAmountIrt: null,
  };

  const pngFile = {
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    originalname: 'r.png',
    mimetype: 'image/png',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findOneCalls.length = 0;

    mockQb = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ identifiers: [{ id: 99 }] }),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    error = {
      unprocessableEntity: jest.fn((msgs, data) => {
        throw new HttpException({ messages: msgs, data }, 422);
      }),
    };

    submissionRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(),
    };
    evidenceRepository = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      })),
    };
    reviewEventRepository = {};
    orderRepository = {
      findOne: jest.fn().mockResolvedValue(eligibleOrder),
    };
    settingRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 1,
        manualPaymentSubmitDeadlineHours: 24,
        manualPaymentReviewHoldHours: 48,
        manualPaymentResubmitGraceHours: 24,
      }),
    };
    bankDestinationService = {
      getById: jest.fn().mockResolvedValue(destination),
      assertRailCompatibility: jest.fn(),
      amountWithinLimits: jest.fn().mockReturnValue(true),
    };
    methodService = {
      getByRail: jest.fn().mockResolvedValue(method),
      amountWithinLimits: jest.fn().mockReturnValue(true),
      listEnabledForCustomer: jest.fn().mockResolvedValue([method]),
    };
    receiptStorage = {
      storeBuffer: jest.fn().mockResolvedValue({
        id: 7,
        storageKey: 'abc.png',
        sha256: 'deadbeef',
        objectKey: 'obj',
      }),
      deleteOrphanReceipt: jest.fn(),
      deleteOrphanFile: jest.fn(),
      getById: jest.fn().mockResolvedValue({ objectKey: 'obj' }),
    };
    capabilityService = {
      assertUserHasCapability: jest.fn(),
    };
    orderService = {};

    mockFindOneImpl = (entity) => {
      if (entity === OrderEntity) {
        return { ...eligibleOrder };
      }
      if (entity === OrderPaymentFinalizationEntity) {
        return null;
      }
      if (entity === PaymentSubmissionEntity) {
        return null;
      }
      return null;
    };

    service = new PaymentSubmissionService(
      submissionRepository,
      evidenceRepository,
      reviewEventRepository,
      orderRepository,
      settingRepository,
      bankDestinationService,
      methodService,
      receiptStorage,
      capabilityService,
      orderService,
      error,
    );
  });

  describe('resolveTimingHours fail-safe', () => {
    it('clamps invalid persisted values to defaults', () => {
      expect(resolveTimingHours(-1, 'submitDeadlineHours')).toBe(24);
      expect(resolveTimingHours(9999, 'reviewHoldHours')).toBe(48);
      expect(resolveTimingHours(0, 'resubmitGraceHours')).toBe(24);
      expect(resolveTimingHours(12, 'submitDeadlineHours')).toBe(12);
    });
  });

  describe('idempotency ownership', () => {
    it('lookup is scoped to customerId+orderId+key', async () => {
      const owned = {
        id: 1,
        customerId: 5,
        orderId: 10,
        idempotencyKey: 'k1',
        status: PaymentSubmissionStatus.SUBMITTED,
        activeEvidenceId: null,
        holdExpiresAt: new Date(Date.now() + 60_000),
      };
      submissionRepository.findOne.mockResolvedValueOnce(owned);
      evidenceRepository.find.mockResolvedValue([]);

      const result = await service.createSubmissionWithEvidence({
        orderId: 10,
        customerId: 5,
        rail: ManualPaymentRail.CARD_TO_CARD,
        bankDestinationId: 1,
        file: pngFile as any,
        idempotencyKey: 'k1',
      });

      expect(submissionRepository.findOne).toHaveBeenCalledWith({
        where: {
          idempotencyKey: 'k1',
          customerId: 5,
          orderId: 10,
        },
      });
      expect(result.id).toBe(1);
      expect(receiptStorage.storeBuffer).not.toHaveBeenCalled();
    });

    it('ER_DUP_ENTRY for non-owned key returns generic invalid request', async () => {
      submissionRepository.findOne
        .mockResolvedValueOnce(null) // initial scoped lookup
        .mockResolvedValueOnce(null); // recovery scoped lookup (not owned)

      mockQb.execute
        .mockRejectedValueOnce(
          Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY', errno: 1062 }),
        );

      await expect(
        service.createSubmissionWithEvidence({
          orderId: 10,
          customerId: 5,
          rail: ManualPaymentRail.CARD_TO_CARD,
          bankDestinationId: 1,
          file: pngFile as any,
          idempotencyKey: 'shared-key',
        }),
      ).rejects.toMatchObject({
        response: { messages: ['درخواست نامعتبر'] },
      });
      expect(receiptStorage.deleteOrphanReceipt).toHaveBeenCalled();
    });
  });

  describe('Order lock before insert (C1 lock order)', () => {
    it('locks Order with pessimistic_write before submission insert', async () => {
      const insertOrder: string[] = [];
      mockQueryRunner.manager.findOne = jest.fn(async (entity, options) => {
        findOneCalls.push({ entity, options });
        if (entity === OrderEntity) {
          insertOrder.push('order-lock');
          return { ...eligibleOrder };
        }
        if (entity === OrderPaymentFinalizationEntity) {
          return null;
        }
        return null;
      });

      mockQb.execute = jest.fn(async () => {
        insertOrder.push('insert');
        return { identifiers: [{ id: 99 }] };
      });
      mockQb.getMany = jest.fn().mockResolvedValue([]);

      submissionRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 99,
          customerId: 5,
          orderId: 10,
          status: PaymentSubmissionStatus.SUBMITTED,
          activeEvidenceId: 1,
          holdExpiresAt: new Date(Date.now() + 60_000),
        });

      await service.createSubmissionWithEvidence({
        orderId: 10,
        customerId: 5,
        rail: ManualPaymentRail.CARD_TO_CARD,
        bankDestinationId: 1,
        file: pngFile as any,
        idempotencyKey: 'lock-test',
      });

      const orderLock = findOneCalls.find((c) => c.entity === OrderEntity);
      expect(orderLock?.options?.lock).toEqual({ mode: 'pessimistic_write' });
      expect(insertOrder.indexOf('order-lock')).toBeLessThan(
        insertOrder.indexOf('insert'),
      );
    });

    it('rejects ineligible locked order without leaving submission', async () => {
      mockQueryRunner.manager.findOne = jest.fn(async (entity: any) => {
        if (entity === OrderEntity) {
          return {
            ...eligibleOrder,
            status: OrderStatus.paid,
            successfulTransactionId: 1,
          };
        }
        return null;
      }) as any;

      const insertSpy = mockQb.execute;

      await expect(
        service.createSubmissionWithEvidence({
          orderId: 10,
          customerId: 5,
          rail: ManualPaymentRail.CARD_TO_CARD,
          bankDestinationId: 1,
          file: pngFile as any,
          idempotencyKey: 'ineligible',
        }),
      ).rejects.toBeInstanceOf(HttpException);

      expect(insertSpy).not.toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(receiptStorage.deleteOrphanReceipt).toHaveBeenCalled();
    });
  });

  describe('method/destination limits on settlement amount', () => {
    it('rejects when settlement outside method limits', async () => {
      methodService.amountWithinLimits.mockReturnValue(false);

      await expect(
        service.createSubmissionWithEvidence({
          orderId: 10,
          customerId: 5,
          rail: ManualPaymentRail.CARD_TO_CARD,
          bankDestinationId: 1,
          file: pngFile as any,
          idempotencyKey: 'limits',
        }),
      ).rejects.toMatchObject({
        response: {
          messages: expect.arrayContaining([
            expect.stringMatching(/محدوده/),
          ]),
        },
      });
      expect(receiptStorage.storeBuffer).not.toHaveBeenCalled();
    });
  });

  describe('expireSubmissionIfNeededDurable', () => {
    it('expires hold in own transaction and returns true', async () => {
      const past = new Date(Date.now() - 60_000);
      const row = {
        id: 3,
        status: PaymentSubmissionStatus.SUBMITTED,
        holdExpiresAt: past,
        activeLockKey: 'ORDER_PAYMENT:10',
      };
      mockQueryRunner.manager.findOne = jest.fn(async () => ({ ...row })) as any;
      mockQueryRunner.manager.save = jest.fn(async (e) => e);

      const did = await service.expireSubmissionIfNeededDurable(3);
      expect(did).toBe(true);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PaymentSubmissionStatus.EXPIRED,
          activeLockKey: null,
        }),
      );
    });

    it('returns false when hold still active', async () => {
      mockQueryRunner.manager.findOne = jest.fn(async () => ({
        id: 3,
        status: PaymentSubmissionStatus.SUBMITTED,
        holdExpiresAt: new Date(Date.now() + 60_000),
        activeLockKey: 'ORDER_PAYMENT:10',
      })) as any;

      const did = await service.expireSubmissionIfNeededDurable(3);
      expect(did).toBe(false);
    });
  });
});
