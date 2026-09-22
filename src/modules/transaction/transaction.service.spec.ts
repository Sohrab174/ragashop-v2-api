const mockQueryRunner = {
  connect: jest.fn(),
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
  release: jest.fn(),
  manager: {
    findOne: jest.fn(),
    save: jest.fn(async (e) => e),
    createQueryBuilder: jest.fn(() => ({
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ identifiers: [{ id: 200 }] }),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    })),
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
import { buildPaypingVerificationErrorFromAxios } from '../../gateway/payping/payping-verification-result';
import { TransactionService } from './transaction.service';
import { TransactionStatus } from './entities/transaction.entity';
import { OrderStatus } from '../order/entities/order.entity';

describe('TransactionService (Phase 1A fix pass)', () => {
  let service: TransactionService;
  let mockTransactionRepository: any;
  let mockOrderService: any;
  let mockGatewayService: any;
  let mockSettingService: any;
  let mockPayping: any;
  let mockConfig: any;
  let mockError: any;
  let builderState: any;

  const customerA = {
    id: 10,
    walletTRY: 0,
    walletIRT: 0,
  };

  const baseDto = {
    orderId: 100,
    gatewayId: 1,
    usedWalletUSD: false,
    usedWalletTRY: false,
    usedWalletIRT: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    builderState = { statusFilter: null as string | null };

    mockError = {
      unprocessableEntity: jest.fn((msgs, data) => {
        throw new HttpException({ messages: msgs, data }, 422);
      }),
      methodNotAllowed: jest.fn((msgs) => {
        throw new HttpException({ messages: msgs }, 405);
      }),
      internalServerError: jest.fn((msgs) => {
        throw new HttpException({ messages: msgs }, 500);
      }),
    };

    mockOrderService = {
      markOrderPaidAtomic: jest.fn().mockResolvedValue('newly_paid'),
      applyReferralRewardsAtomic: jest.fn(),
      recognizeCogsFromOrderItemSnapshots: jest.fn(),
      sendPostPaymentNotifications: jest.fn(),
      finalizeOrderPaymentAtomic: jest.fn().mockResolvedValue('finalized'),
      claimOrderPaymentFinalization: jest.fn().mockResolvedValue('claimed'),
    };

    mockGatewayService = {
      getById: jest.fn().mockResolvedValue({
        id: 1,
        name: 'payping',
        merchantId: 'test-merchant',
      }),
    };

    mockSettingService = {
      getTryToToman: jest.fn().mockResolvedValue(1000),
      getByAdmin: jest.fn().mockResolvedValue({
        walletSpendEnabled: true,
        onlineGatewayPaymentsEnabled: true,
      }),
    };

    mockPayping = {
      getRedirectUrl: jest.fn(
        (token) => `https://ragaex.co/payping.php?token=${token}`,
      ),
      paymentRequest: jest
        .fn()
        .mockResolvedValue({ authority: 'auth123', url: 'https://bank.test' }),
      paymentVerification: jest.fn().mockResolvedValue('verified'),
    };

    mockConfig = {
      app: { apiBaseUrl: 'http://localhost', siteBaseUrl: 'http://site.test' },
    };

    mockTransactionRepository = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => {
        const chain: any = {
          innerJoinAndSelect: jest.fn().mockReturnThis(),
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          andWhere: jest.fn(function (arg) {
            if (arg?.status) {
              builderState.statusFilter = arg.status;
            }
            return chain;
          }),
          getOne: jest.fn().mockImplementation(async () => {
            if (builderState.statusFilter === TransactionStatus.pending) {
              return null;
            }
            return {
              id: 77,
              orderId: 100,
              amount: 50000,
              status: TransactionStatus.paid,
              referenceNumber: '123456',
              createdAt: new Date(),
              order: { number: '1401011' },
              gateway: { merchantId: 'm', name: 'payping' },
              customer: { walletTRY: 0, walletIRT: 0 },
            };
          }),
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue({ affected: 0 }),
        };
        return chain;
      }),
    };

    service = new TransactionService(
      mockTransactionRepository,
      mockConfig,
      mockError,
      mockPayping,
      mockOrderService,
      mockGatewayService,
      mockSettingService,
      {} as any,
    );
  });

  it('verifyPayping finds already-paid transaction via real builder (no pending-only filter)', async () => {
    const redirectUrl = await service.verifyPayping(
      'auth123',
      '999999',
      '****',
    );

    expect(redirectUrl).toContain('status=success');
    expect(mockPayping.paymentVerification).not.toHaveBeenCalled();
    expect(builderState.statusFilter).not.toBe(TransactionStatus.pending);
  });

  it('resumes existing pending attempt with reconstructed bankUrl', async () => {
    mockQueryRunner.manager.findOne = jest
      .fn()
      .mockResolvedValueOnce({
        id: 100,
        customerId: 10,
        finalAmount: 100,
        commercialCurrency: 'TRY',
        fxRateToIrt: 3500,
        status: OrderStatus.pending,
      })
      .mockResolvedValueOnce({
        id: 55,
        amount: 350000,
        settlementCurrency: 'IRT',
        commercialAmount: 100,
        commercialCurrency: 'TRY',
        fxRateToIrt: 3500,
        randomToken: 'tok-abc',
        gatewayRedirectUrl: null,
        gatewaySessionStatus: 'not_started',
        status: TransactionStatus.pending,
      });

    const result = await service.add(baseDto, customerA as any, '127.0.0.1');

    expect(result.transactionId).toBe(55);
    expect(result.bankUrl).toBe('https://ragaex.co/payping.php?token=tok-abc');
    expect(mockPayping.getRedirectUrl).toHaveBeenCalledWith('tok-abc');
  });

  it('rejects resume of legacy pending tx missing settlement metadata', async () => {
    mockQueryRunner.manager.findOne = jest
      .fn()
      .mockResolvedValueOnce({
        id: 100,
        customerId: 10,
        finalAmount: 100,
        commercialCurrency: 'TRY',
        fxRateToIrt: 3500,
        status: OrderStatus.pending,
      })
      .mockResolvedValueOnce({
        id: 55,
        amount: 50000,
        settlementCurrency: null,
        commercialAmount: null,
        commercialCurrency: null,
        fxRateToIrt: null,
        randomToken: 'tok-abc',
        gatewayRedirectUrl: null,
        gatewaySessionStatus: 'not_started',
        status: TransactionStatus.pending,
      });

    await expect(
      service.add(baseDto, customerA as any, '127.0.0.1'),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        data: { code: 'legacy_transaction_settlement_metadata_missing' },
      },
    });
  });

  it('rejects resume when Order FX snapshot is missing', async () => {
    mockQueryRunner.manager.findOne = jest
      .fn()
      .mockResolvedValueOnce({
        id: 100,
        customerId: 10,
        finalAmount: 100,
        commercialCurrency: 'TRY',
        fxRateToIrt: null,
        status: OrderStatus.pending,
      })
      .mockResolvedValueOnce({
        id: 55,
        amount: 350000,
        settlementCurrency: 'IRT',
        commercialAmount: 100,
        commercialCurrency: 'TRY',
        fxRateToIrt: 3500,
        status: TransactionStatus.pending,
      });

    await expect(
      service.add(baseDto, customerA as any, '127.0.0.1'),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        data: { code: 'order_fx_snapshot_missing' },
      },
    });
  });

  it('verifyPayping rejects legacy pending without settlement metadata', async () => {
    mockTransactionRepository.createQueryBuilder = jest.fn(() => {
      const chain: any = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: 77,
          orderId: 100,
          amount: 50000,
          settlementCurrency: null,
          commercialAmount: null,
          commercialCurrency: null,
          fxRateToIrt: null,
          status: TransactionStatus.pending,
          referenceNumber: null,
          createdAt: new Date(),
          order: {
            number: '1401011',
            id: 100,
            commercialCurrency: 'TRY',
            fxRateToIrt: 3500,
          },
          gateway: { merchantId: 'm', name: 'payping' },
          customer: { walletTRY: 0, walletIRT: 0 },
        }),
      };
      return chain;
    });

    const redirectUrl = await service.verifyPayping(
      'auth-legacy',
      '123456',
      '****',
    );

    expect(redirectUrl).toContain('code=507');
    expect(mockPayping.paymentVerification).not.toHaveBeenCalled();
  });

  it('verifyPayping marks timeout as uncertain not failed', async () => {
    mockTransactionRepository.findOne.mockResolvedValue(null);
    mockTransactionRepository.createQueryBuilder = jest.fn(() => {
      const chain: any = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: 77,
          orderId: 100,
          amount: 350000,
          settlementCurrency: 'IRT',
          commercialAmount: 100,
          commercialCurrency: 'TRY',
          fxRateToIrt: 3500,
          status: TransactionStatus.pending,
          referenceNumber: null,
          createdAt: new Date(),
          order: {
            number: '1401011',
            id: 100,
            commercialCurrency: 'TRY',
            fxRateToIrt: 3500,
          },
          gateway: { merchantId: 'm', name: 'payping' },
          customer: { walletTRY: 0, walletIRT: 0 },
        }),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      return chain;
    });

    mockQueryRunner.manager.save = jest.fn(async (e) => e);
    mockQueryRunner.manager.findOne = jest
      .fn()
      .mockResolvedValueOnce({
        id: 77,
        orderId: 100,
        status: TransactionStatus.pending,
      })
      .mockResolvedValueOnce({
        id: 100,
        status: OrderStatus.pending,
        successfulTransactionId: null,
      })
      .mockResolvedValueOnce({
        id: 77,
        orderId: 100,
        status: TransactionStatus.pending,
      })
      .mockResolvedValueOnce(null);

    const timeoutError = buildPaypingVerificationErrorFromAxios({
      code: 'ETIMEDOUT',
      message: 'تراکنش ناموفق بود',
    });
    mockPayping.paymentVerification.mockRejectedValue(timeoutError);

    const redirectUrl = await service.verifyPayping(
      'auth-timeout',
      '123456',
      '****',
    );

    expect(redirectUrl).toContain('code=505');
    expect(mockPayping.paymentVerification).toHaveBeenCalled();
    expect(mockTransactionRepository.createQueryBuilder).toHaveBeenCalled();
  });

  it('verifyPayping does not call provider when order already rejected', async () => {
    mockTransactionRepository.createQueryBuilder = jest.fn(() => {
      const chain: any = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: 77,
          orderId: 100,
          amount: 350000,
          settlementCurrency: 'IRT',
          commercialAmount: 100,
          commercialCurrency: 'TRY',
          fxRateToIrt: 3500,
          status: TransactionStatus.pending,
          referenceNumber: null,
          createdAt: new Date(),
          order: {
            number: '1401011',
            id: 100,
            commercialCurrency: 'TRY',
            fxRateToIrt: 3500,
          },
          gateway: { merchantId: 'm', name: 'payping' },
          customer: { walletTRY: 0, walletIRT: 0 },
        }),
      };
      return chain;
    });

    mockQueryRunner.manager.findOne = jest
      .fn()
      .mockResolvedValueOnce({
        id: 77,
        orderId: 100,
        status: TransactionStatus.pending,
      })
      .mockResolvedValueOnce({
        id: 100,
        status: OrderStatus.rejected,
        successfulTransactionId: null,
      })
      .mockResolvedValueOnce({
        id: 77,
        orderId: 100,
        status: TransactionStatus.pending,
      })
      .mockResolvedValueOnce(null);

    const redirectUrl = await service.verifyPayping(
      'auth-rejected',
      '123456',
      '****',
    );

    expect(redirectUrl).toContain('code=504');
    expect(mockPayping.paymentVerification).not.toHaveBeenCalled();
  });

  it('markVerificationStarted returns order_missing without authorizing', async () => {
    mockQueryRunner.manager.findOne = jest
      .fn()
      .mockResolvedValueOnce({
        id: 77,
        orderId: 100,
        status: TransactionStatus.pending,
      })
      .mockResolvedValueOnce(null);

    const result = await (service as any).markVerificationStarted(77, '123456');
    expect(result).toBe('order_missing');
  });

  it('markVerificationStarted returns transaction_missing without authorizing', async () => {
    mockQueryRunner.manager.findOne = jest.fn().mockResolvedValueOnce(null);

    const result = await (service as any).markVerificationStarted(77, '123456');
    expect(result).toBe('transaction_missing');
  });

  it('markVerificationStarted resumes already_started when order still pending', async () => {
    mockQueryRunner.manager.save = jest.fn(async (e) => e);
    mockQueryRunner.manager.findOne = jest
      .fn()
      .mockResolvedValueOnce({
        id: 77,
        orderId: 100,
        status: TransactionStatus.verification_started,
      })
      .mockResolvedValueOnce({
        id: 100,
        status: OrderStatus.pending,
        successfulTransactionId: null,
      })
      .mockResolvedValueOnce({
        id: 77,
        orderId: 100,
        status: TransactionStatus.verification_started,
      })
      .mockResolvedValueOnce(null);

    const result = await (service as any).markVerificationStarted(77, '123456');
    expect(result).toBe('already_started');
  });

  it('creates gateway transaction with IRT settlement from Order FX snapshot', async () => {
    const inserted: any[] = [];
    mockQueryRunner.manager.findOne = jest
      .fn()
      .mockResolvedValueOnce({
        id: 100,
        customerId: 10,
        finalAmount: 100,
        commercialCurrency: 'TRY',
        fxRateToIrt: 3500,
        status: OrderStatus.pending,
      })
      .mockResolvedValueOnce(null) // no pending tx
      .mockResolvedValueOnce({
        id: 10,
        walletTRY: 0,
        walletIRT: 0,
        isDeleted: false,
      });

    mockQueryRunner.manager.createQueryBuilder = jest.fn(() => ({
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn((v) => {
        inserted.push(v);
        return {
          execute: jest.fn().mockResolvedValue({ identifiers: [{ id: 200 }] }),
        };
      }),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    }));

    jest.spyOn(service as any, 'getPendingTransactionById').mockResolvedValue({
      id: 200,
      amount: 350000,
      status: TransactionStatus.pending,
      gatewayRedirectUrl: null,
      randomToken: null,
      gatewaySessionStatus: 'not_started',
      gateway: { merchantId: 'm', name: 'payping' },
    });
    jest
      .spyOn(service as any, 'buildPaymentInitiationResponse')
      .mockResolvedValue({
        transactionId: 200,
        bankUrl: 'https://bank.test',
        paid: false,
      });

    await service.add(baseDto, customerA as any, '127.0.0.1');

    expect(inserted[0].amount).toBe(350000);
    expect(inserted[0].settlementCurrency).toBe('IRT');
    expect(inserted[0].commercialAmount).toBe(100);
    expect(inserted[0].commercialCurrency).toBe('TRY');
    expect(inserted[0].fxRateToIrt).toBe(3500);
  });

  it('wallet-only stores full settlement amount and finalizes without gateway', async () => {
    const inserted: any[] = [];
    const walletCustomer = {
      id: 10,
      walletTRY: 100,
      walletIRT: 0,
      isDeleted: false,
    };

    mockQueryRunner.manager.findOne = jest
      .fn()
      .mockResolvedValueOnce({
        id: 100,
        customerId: 10,
        finalAmount: 100,
        commercialCurrency: 'TRY',
        fxRateToIrt: 3500,
        status: OrderStatus.pending,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(walletCustomer);

    mockQueryRunner.manager.createQueryBuilder = jest.fn(() => ({
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn((v) => {
        inserted.push(v);
        return {
          execute: jest.fn().mockResolvedValue({ identifiers: [{ id: 201 }] }),
        };
      }),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    }));

    const result = await service.add(
      { ...baseDto, usedWalletTRY: true },
      walletCustomer as any,
      '127.0.0.1',
    );

    expect(result.paid).toBe(true);
    expect(result.bankUrl).toBeNull();
    expect(inserted[0].amount).toBe(350000);
    expect(inserted[0].walletAmount).toBe(350000);
    expect(inserted[0].status).toBe(TransactionStatus.paid);
    expect(mockOrderService.finalizeOrderPaymentAtomic).toHaveBeenCalled();
  });

  it('hybrid wallet+gateway stores settlement amount with reduced wallet cover', async () => {
    const inserted: any[] = [];
    const walletCustomer = {
      id: 10,
      walletTRY: 10,
      walletIRT: 0,
      isDeleted: false,
    };

    mockQueryRunner.manager.findOne = jest
      .fn()
      .mockResolvedValueOnce({
        id: 100,
        customerId: 10,
        finalAmount: 100,
        commercialCurrency: 'TRY',
        fxRateToIrt: 3500,
        status: OrderStatus.pending,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(walletCustomer);

    mockQueryRunner.manager.createQueryBuilder = jest.fn(() => ({
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn((v) => {
        inserted.push(v);
        return {
          execute: jest.fn().mockResolvedValue({ identifiers: [{ id: 202 }] }),
        };
      }),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    }));

    jest.spyOn(service as any, 'getPendingTransactionById').mockResolvedValue({
      id: 202,
      amount: 350000,
      walletAmount: 35000,
      status: TransactionStatus.pending,
      gatewayRedirectUrl: null,
      randomToken: null,
      gatewaySessionStatus: 'not_started',
      gateway: { merchantId: 'm', name: 'payping' },
    });
    jest
      .spyOn(service as any, 'buildPaymentInitiationResponse')
      .mockResolvedValue({
        transactionId: 202,
        bankUrl: 'https://bank.test',
        paid: false,
      });

    await service.add(
      { ...baseDto, usedWalletTRY: true },
      walletCustomer as any,
      '127.0.0.1',
    );

    expect(inserted[0].amount).toBe(350000);
    expect(inserted[0].walletAmount).toBe(35000);
    expect(inserted[0].walletTRY).toBe(10);
    expect(inserted[0].status).toBe(TransactionStatus.pending);
  });

  it('rejects NEW pending gateway launch when onlineGatewayPaymentsEnabled is false', async () => {
    mockSettingService.getByAdmin.mockResolvedValue({
      walletSpendEnabled: true,
      onlineGatewayPaymentsEnabled: false,
    });

    mockQueryRunner.manager.findOne = jest
      .fn()
      .mockResolvedValueOnce({
        id: 100,
        customerId: 10,
        finalAmount: 100,
        commercialCurrency: 'TRY',
        fxRateToIrt: 3500,
        status: OrderStatus.pending,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 10,
        walletTRY: 0,
        walletIRT: 0,
        isDeleted: false,
      });

    await expect(
      service.add(baseDto, customerA as any, '127.0.0.1'),
    ).rejects.toMatchObject({
      response: {
        messages: ['پرداخت آنلاین از طریق درگاه فعلاً غیرفعال است'],
        data: { code: 'online_gateway_disabled' },
      },
    });
    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
  });

  it('still resumes existing pending when onlineGatewayPaymentsEnabled is false', async () => {
    mockSettingService.getByAdmin.mockResolvedValue({
      walletSpendEnabled: true,
      onlineGatewayPaymentsEnabled: false,
    });

    mockQueryRunner.manager.findOne = jest
      .fn()
      .mockResolvedValueOnce({
        id: 100,
        customerId: 10,
        finalAmount: 100,
        commercialCurrency: 'TRY',
        fxRateToIrt: 3500,
        status: OrderStatus.pending,
      })
      .mockResolvedValueOnce({
        id: 55,
        amount: 350000,
        settlementCurrency: 'IRT',
        commercialAmount: 100,
        commercialCurrency: 'TRY',
        fxRateToIrt: 3500,
        randomToken: 'tok-abc',
        gatewayRedirectUrl: null,
        gatewaySessionStatus: 'not_started',
        status: TransactionStatus.pending,
      });

    const result = await service.add(baseDto, customerA as any, '127.0.0.1');

    expect(result.transactionId).toBe(55);
    expect(result.bankUrl).toBe('https://ragaex.co/payping.php?token=tok-abc');
    expect(mockSettingService.getByAdmin).not.toHaveBeenCalled();
  });
});
