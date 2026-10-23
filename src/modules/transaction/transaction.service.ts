import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { getConnection, Repository } from 'typeorm';
import {
  GATEWAY_SESSION_LEASE_MS,
  GatewaySessionStatus,
  TransactionEntity,
  TransactionPaymentSource,
  TransactionStatus,
} from './entities/transaction.entity';
import { ErrorService } from '../../error/error.service';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  generateRandomDigitCode,
  paginationResult,
  sleep,
} from '../../utils';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { CustomerEntity } from '../customer/entities/customer.entity';
import { OrderEntity } from '../order/entities/order.entity';
import {
  isOrderAlreadyPaid,
  isOrderPaymentInitiatable,
} from '../order/utils/order-payable-states';
import { PaypingService } from '../../gateway/payping/payping.service';
import { GatewayStatus } from '../gateway/entities/gateway.entity';
import { ConfigurationService } from '../../config/configuration.service';
import * as moment from 'jalali-moment';
import { OrderService } from '../order/order.service';
import { GatewayService } from '../gateway/gateway.service';
import { SettingService } from '../setting/setting.service';
import { CustomerService } from '../customer/customer.service';
import { WalletHistoryType } from '../customer/entities/wallet-history.entity';
import { classifyPaypingVerificationError } from '../../gateway/payping/payping-verification.classifier';
import { validatePaypingReferenceNumber } from '../../gateway/payping/payping-reference.validator';
import {
  PaypingVerificationError,
  isPaypingPaymentRequestError,
  isPaypingVerificationError,
} from '../../gateway/payping/payping-verification-result';
import { parseStrictPositiveInt } from '../order/utils/commerce-input.validator';
import { notifyPostPaymentBestEffort } from '../order/utils/post-payment-notify';
import { OrderPaymentFinalizationEntity } from '../order/entities/order-payment-finalization.entity';
import {
  assertFin1SettlementEvidence,
  computeSettlementFromOrderSnapshot,
  getGatewayChargeIrt,
  LEGACY_TRANSACTION_SETTLEMENT_METADATA_MISSING,
} from '../finance/settlement-money';
import { randomBytes } from 'crypto';

const RECONCILABLE_TRANSACTION_STATUSES = [
  TransactionStatus.pending,
  TransactionStatus.verification_started,
  TransactionStatus.verification_uncertain,
];

/**
 * Explicit authorization to call the payment provider for verification.
 * Only `started` / `already_started` permit provider API calls.
 */
export type PaypingVerificationStartResult =
  | 'started'
  | 'already_started'
  | 'not_payable'
  | 'order_missing'
  | 'transaction_missing'
  | 'transaction_not_eligible'
  | 'already_finalized';

export function isPaypingVerificationAuthorized(
  result: PaypingVerificationStartResult,
): boolean {
  return result === 'started' || result === 'already_started';
}

@Injectable()
export class TransactionService {
  constructor(
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,

    private config: ConfigurationService,
    private error: ErrorService,
    private payping: PaypingService,
    private orderService: OrderService,
    private gatewayService: GatewayService,
    private settingService: SettingService,
    private customerService: CustomerService,
  ) {}

  /**
   * -------------------------------------------------------
   * GET /transactions
   */
  async getAll(page = 1, limit = 20, filters = null, sorts = null, customerId) {
    let builder = this.transactionRepository
      .createQueryBuilder('transaction')

      .leftJoin('transaction.order', 'order')
      .select([
        'transaction.id',
        'transaction.amount',
        'transaction.referenceNumber',
        'transaction.message',
        'transaction.status',
        'transaction.createdAt',

        'order.id',
        'order.number',
      ]);

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('transaction.createdAt', 'ASC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    builder.andWhere({ customerId });

    const [items, totalItems] = await builder
      .take(limit)
      .skip((page - 1) * limit)
      .getManyAndCount();

    return {
      items,
      pagination: paginationResult(page, limit, totalItems),
    };
  }

  /**
   * -------------------------------------------------------
   * GET /transactions/admin
   */
  async getAllForAdmin(page = 1, limit = 20, filters = null, sorts = null) {
    let builder = this.transactionRepository
      .createQueryBuilder('transaction')
      .leftJoin('transaction.gateway', 'gateway')
      .addSelect('gateway.id')
      .addSelect('gateway.name');

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('transaction.id', 'ASC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    const [items, totalItems] = await builder
      .take(limit)
      .skip((page - 1) * limit)
      .getManyAndCount();

    return {
      items,
      pagination: paginationResult(page, limit, totalItems),
    };
  }

  /**
   * -------------------------------------------------------
   * POST /transactions
   */
  async add(dto: CreateTransactionDto, customer: CustomerEntity, ip: string) {
    const orderId = parseStrictPositiveInt(
      dto.orderId,
      this.error,
      'سفارش موردنظر پیدا نشد',
    );
    const gatewayId = parseStrictPositiveInt(
      dto.gatewayId,
      this.error,
      'درگاه پرداخت نامعتبر است',
    );

    const gateway = await this.gatewayService.getById(gatewayId);

    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let newTransactionId: number;
    let walletOnlyPaid = false;
    let paidOrderId: number = null;
    let resumePending: TransactionEntity = null;

    try {
      const order = await queryRunner.manager.findOne(OrderEntity, {
        where: { id: orderId, customerId: customer.id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!order) {
        this.error.unprocessableEntity(['سفارش موردنظر پیدا نشد']);
      }

      if (isOrderAlreadyPaid(order.status)) {
        this.error.unprocessableEntity(['این سفارش پرداخت شده است']);
      }

      if (!isOrderPaymentInitiatable(order.status)) {
        this.error.unprocessableEntity(['این سفارش قابل پرداخت نمی‌باشد']);
      }

      const existingPending = await queryRunner.manager.findOne(
        TransactionEntity,
        {
          where: {
            orderId,
            customerId: customer.id,
            status: TransactionStatus.pending,
          },
          lock: { mode: 'pessimistic_write' },
        },
      );

      if (existingPending) {
        this.rejectUnlessFin1SettlementEvidence(existingPending, order);
        resumePending = existingPending;
        await queryRunner.commitTransaction();
      } else {
        const lockedCustomer = await queryRunner.manager.findOne(
          CustomerEntity,
          {
            where: { id: customer.id, isDeleted: false },
            lock: { mode: 'pessimistic_write' },
          },
        );

        if (!lockedCustomer) {
          this.error.unprocessableEntity(['مشتری یافت نشد']);
        }

        // F1: settlement IRT from Order FX snapshot (not live TGJU, not raw TRY).
        let settlement;
        try {
          settlement = computeSettlementFromOrderSnapshot(order);
        } catch (e) {
          if (e?.message === 'order_fx_snapshot_missing') {
            this.error.unprocessableEntity(
              ['نرخ ارز سفارش موجود نیست. امکان پرداخت وجود ندارد.'],
              { code: 'order_fx_snapshot_missing' },
            );
          }
          throw e;
        }

        let walletAmount = 0;
        let walletTRY = 0;
        let walletIRT = 0;
        let payAmount = settlement.settlementAmount;
        let status = TransactionStatus.pending;
        const orderFx = settlement.fxRateToIrt;

        const setting = await this.settingService.getByAdmin();

        const walletRequested = !!(dto.usedWalletTRY || dto.usedWalletIRT);
        if (walletRequested) {
          if (!setting?.walletSpendEnabled) {
            this.error.unprocessableEntity(
              ['پرداخت با کیف پول فعلاً غیرفعال است'],
              { code: 'wallet_spend_disabled' },
            );
          }
        }

        if (dto.usedWalletTRY && lockedCustomer.walletTRY > 0) {
          const wallet = lockedCustomer.walletTRY * orderFx;

          if (wallet >= payAmount) {
            walletTRY = payAmount / orderFx;
            walletAmount += payAmount;
            payAmount = 0;
          } else {
            walletTRY = lockedCustomer.walletTRY;
            walletAmount += wallet;
            payAmount -= wallet;
          }
        }

        if (
          payAmount > 0 &&
          dto.usedWalletIRT &&
          lockedCustomer.walletIRT > 0
        ) {
          if (lockedCustomer.walletIRT >= payAmount) {
            walletIRT = payAmount;
            walletAmount += payAmount;
            payAmount = 0;
          } else {
            walletIRT = lockedCustomer.walletIRT;
            walletAmount += walletIRT;
            payAmount -= walletIRT;
          }
        }

        if (payAmount === 0) {
          const walletUpdate = await queryRunner.manager
            .createQueryBuilder()
            .update(CustomerEntity)
            .set({
              walletTRY: () => 'walletTRY - :walletTRY',
              walletIRT: () => 'walletIRT - :walletIRT',
            })
            .setParameters({ walletTRY, walletIRT })
            .where(
              'id = :id AND walletTRY >= :walletTRY AND walletIRT >= :walletIRT',
              {
                id: customer.id,
                walletTRY,
                walletIRT,
              },
            )
            .execute();

          if (walletUpdate.affected === 0) {
            this.error.unprocessableEntity(['موجودی کیف پول کافی نمی‌باشد']);
          }

          status = TransactionStatus.paid;
        }

        // C2A launch gate: block NEW pending gateway txs only (not resume/verify/reconcile).
        if (
          status === TransactionStatus.pending &&
          setting &&
          setting.onlineGatewayPaymentsEnabled === false
        ) {
          this.error.unprocessableEntity(
            ['پرداخت آنلاین از طریق درگاه فعلاً غیرفعال است'],
            { code: 'online_gateway_disabled' },
          );
        }

        // F1: amount = full settlement IRT; gateway charge = amount − walletAmount.
        const { identifiers } = await queryRunner.manager
          .createQueryBuilder()
          .insert()
          .into(TransactionEntity)
          .values({
            orderId,
            customerId: customer.id,
            gatewayId,
            amount: settlement.settlementAmount,
            settlementCurrency: settlement.settlementCurrency,
            fxRateToIrt: settlement.fxRateToIrt,
            commercialAmount: settlement.commercialAmount,
            commercialCurrency: settlement.commercialCurrency,
            // Fee not booked on initiate; NULL = no fee recorded (not 0).
            paymentFeeAmount: null,
            paymentFeeCurrency: null,
            walletAmount,
            walletIRT,
            walletTRY,
            walletUSD: 0,
            reduceCardAmount: 0,
            terminalId: gateway.merchantId || null,
            merchantId: gateway.merchantId || null,
            status,
            paymentSource:
              status === TransactionStatus.paid
                ? TransactionPaymentSource.wallet
                : TransactionPaymentSource.gateway,
            ip,
            createdAt: new Date(),
          })
          .execute();

        newTransactionId = identifiers[0].id;

        if (status === TransactionStatus.paid) {
          if (walletTRY > 0) {
            await queryRunner.manager
              .createQueryBuilder()
              .insert()
              .into('wallet_history')
              .values({
                customerId: customer.id,
                walletTRY: -1 * walletTRY,
                type: WalletHistoryType.buy,
                relatedOrderId: order.id,
                createdAt: new Date(),
              })
              .execute();
          }
          if (walletIRT > 0) {
            await queryRunner.manager
              .createQueryBuilder()
              .insert()
              .into('wallet_history')
              .values({
                customerId: customer.id,
                walletIRT: -1 * walletIRT,
                type: WalletHistoryType.buy,
                relatedOrderId: order.id,
                createdAt: new Date(),
              })
              .execute();
          }

          await queryRunner.manager
            .createQueryBuilder()
            .update(TransactionEntity)
            .set({
              referenceNumber: `WALLET-${newTransactionId}`,
              paidAt: new Date(),
              message: 'پرداخت با کیف پول',
            })
            .where('id = :id', { id: newTransactionId })
            .execute();

          const finalizeResult =
            await this.orderService.finalizeOrderPaymentAtomic(
              order.id,
              newTransactionId,
              queryRunner,
            );

          if (finalizeResult === 'superseded') {
            this.error.unprocessableEntity(['این سفارش قبلاً پرداخت شده است']);
          }

          walletOnlyPaid =
            finalizeResult === 'finalized' || finalizeResult === 'idempotent';
          paidOrderId = order.id;
        }

        await queryRunner.commitTransaction();
      }
    } catch (err) {
      await queryRunner.rollbackTransaction();

      if (err?.status) {
        throw err;
      }

      this.error.methodNotAllowed(['خطایی رخ داده است']);
    } finally {
      await queryRunner.release();
    }

    if (resumePending) {
      return this.buildPaymentInitiationResponse(resumePending);
    }

    if (walletOnlyPaid) {
      await notifyPostPaymentBestEffort(this.orderService, paidOrderId);
      return { transactionId: newTransactionId, bankUrl: null, paid: true };
    }

    const transaction = await this.getPendingTransactionById(newTransactionId);
    return this.buildPaymentInitiationResponse(transaction);
  }

  private async buildPaymentInitiationResponse(transaction: TransactionEntity) {
    if (
      transaction.status === TransactionStatus.paid &&
      (transaction.paymentSource === TransactionPaymentSource.wallet ||
        getGatewayChargeIrt(transaction) === 0)
    ) {
      return {
        transactionId: transaction.id,
        bankUrl: null,
        paid: true,
      };
    }

    const bankUrl = await this.resolveGatewayBankUrl(transaction);

    return {
      transactionId: transaction.id,
      bankUrl,
      paid: false,
    };
  }

  private async resolveGatewayBankUrl(
    transaction: TransactionEntity,
  ): Promise<string | null> {
    if (
      transaction.gatewayRedirectUrl &&
      transaction.randomToken &&
      transaction.gatewaySessionStatus === GatewaySessionStatus.ready
    ) {
      return transaction.gatewayRedirectUrl;
    }

    if (transaction.randomToken) {
      return this.payping.getRedirectUrl(transaction.randomToken);
    }

    if (transaction.gatewaySessionStatus === GatewaySessionStatus.uncertain) {
      this.error.internalServerError([
        'نشست درگاه در وضعیت نامشخص است و نیاز به بررسی دارد',
      ]);
    }

    if (transaction.gatewaySessionStatus === GatewaySessionStatus.not_started) {
      const session = await this.ensureGatewaySession(transaction.id);
      return session.bankUrl;
    }

    if (transaction.gatewaySessionStatus === GatewaySessionStatus.creating) {
      const session = await this.ensureGatewaySession(transaction.id);
      return session.bankUrl;
    }

    return transaction.gatewayRedirectUrl;
  }

  /**
   * -------------------------------------------------------
   */
  private getTransactionBuilder() {
    return this.transactionRepository
      .createQueryBuilder('transaction')
      .innerJoinAndSelect(
        'transaction.gateway',
        'gateway',
        'gateway.isDeleted = 0 AND gateway.status = :status',
        { status: GatewayStatus.active },
      );
  }

  private async getPendingTransactionById(id: number) {
    const transaction = await this.getTransactionBuilder()
      .leftJoinAndSelect('transaction.customer', 'customer')
      .andWhere({ id, status: TransactionStatus.pending })
      .getOne();

    if (!transaction) {
      this.error.unprocessableEntity(['این درخواست نامعتبر است']);
    }

    return transaction;
  }

  private async getTransactionByAuthority(randomToken: string) {
    const transaction = await this.getTransactionBuilder()
      .andWhere({ randomToken })
      .leftJoinAndSelect('transaction.order', 'order')
      .leftJoinAndSelect('transaction.customer', 'customer')
      .leftJoinAndSelect('order.orderItems', 'orderItems')
      .leftJoinAndSelect('orderItems.product', 'product')
      .getOne();

    return transaction;
  }

  /**
   * Legacy pending rows (NULL FIN-1 settlement metadata) must not enter
   * modern gateway resume / session / verify flows.
   */
  private rejectUnlessFin1SettlementEvidence(
    transaction: TransactionEntity,
    order?: OrderEntity | null,
  ): void {
    try {
      assertFin1SettlementEvidence(transaction, order ?? null);
    } catch (e) {
      if (e?.message === LEGACY_TRANSACTION_SETTLEMENT_METADATA_MISSING) {
        this.error.unprocessableEntity(
          [
            'اطلاعات تسویه این تراکنش ناقص است و قابل ادامه نیست. لطفاً سفارش را مجدداً پرداخت کنید.',
          ],
          { code: LEGACY_TRANSACTION_SETTLEMENT_METADATA_MISSING },
        );
      }
      if (e?.message === 'order_fx_snapshot_missing') {
        this.error.unprocessableEntity(
          ['نرخ ارز سفارش موجود نیست. امکان پرداخت وجود ندارد.'],
          { code: 'order_fx_snapshot_missing' },
        );
      }
      throw e;
    }
  }

  /**
   * Create or resume gateway session with attempt-level locking and lease.
   */
  private async ensureGatewaySession(
    transactionId: number,
    waitAttempt = 0,
  ): Promise<{ bankUrl: string }> {
    const lockRunner = getConnection().createQueryRunner();
    await lockRunner.connect();
    await lockRunner.startTransaction();

    let lockedTx: TransactionEntity;
    let shouldCallProvider = false;
    let leaseToken: string;

    try {
      lockedTx = await lockRunner.manager.findOne(TransactionEntity, {
        where: { id: transactionId },
        relations: ['gateway', 'order'],
        lock: { mode: 'pessimistic_write' },
      });

      if (!lockedTx) {
        this.error.unprocessableEntity(['این درخواست نامعتبر است']);
      }

      this.rejectUnlessFin1SettlementEvidence(
        lockedTx,
        lockedTx.order ?? null,
      );

      if (
        lockedTx.gatewayRedirectUrl &&
        lockedTx.randomToken &&
        lockedTx.gatewaySessionStatus === GatewaySessionStatus.ready
      ) {
        await lockRunner.commitTransaction();
        return { bankUrl: lockedTx.gatewayRedirectUrl };
      }

      if (lockedTx.gatewaySessionStatus === GatewaySessionStatus.uncertain) {
        if (lockedTx.randomToken) {
          await lockRunner.commitTransaction();
          return { bankUrl: this.payping.getRedirectUrl(lockedTx.randomToken) };
        }

        await lockRunner.manager.update(
          TransactionEntity,
          { id: transactionId },
          {
            message:
              'gateway_session_uncertain_requires_reconciliation_no_blind_retry',
          },
        );
        await lockRunner.commitTransaction();
        this.error.internalServerError([
          'نشست درگاه در وضعیت نامشخص است و نیاز به بررسی دارد',
        ]);
      }

      if (lockedTx.gatewaySessionStatus === GatewaySessionStatus.creating) {
        const leaseValid =
          lockedTx.gatewaySessionLeaseExpiresAt &&
          new Date(lockedTx.gatewaySessionLeaseExpiresAt) > new Date();

        if (leaseValid) {
          await lockRunner.commitTransaction();
          if (waitAttempt >= 20) {
            this.error.internalServerError([
              'اتصال به درگاه بانک برقرار نشد، لطفا مجدد تلاش کنید',
            ]);
          }
          await sleep(300);
          return this.ensureGatewaySession(transactionId, waitAttempt + 1);
        }

        await lockRunner.manager.update(
          TransactionEntity,
          { id: transactionId },
          {
            gatewaySessionStatus: GatewaySessionStatus.uncertain,
            message: 'gateway_session_lease_expired_requires_reconciliation',
          },
        );
        await lockRunner.commitTransaction();
        this.error.internalServerError([
          'نشست درگاه منقضی شده و نیاز به بررسی دارد',
        ]);
      }

      leaseToken = randomBytes(16).toString('hex');
      const leaseExpiresAt = new Date(Date.now() + GATEWAY_SESSION_LEASE_MS);

      await lockRunner.manager.update(
        TransactionEntity,
        { id: transactionId },
        {
          gatewaySessionStatus: GatewaySessionStatus.creating,
          gatewaySessionStartedAt: new Date(),
          gatewaySessionLeaseToken: leaseToken,
          gatewaySessionLeaseExpiresAt: leaseExpiresAt,
        },
      );
      shouldCallProvider = true;
      await lockRunner.commitTransaction();
    } catch (err) {
      await lockRunner.rollbackTransaction();
      throw err;
    } finally {
      await lockRunner.release();
    }

    if (!shouldCallProvider) {
      this.error.internalServerError([
        'اتصال به درگاه بانک برقرار نشد، لطفا مجدد تلاش کنید',
      ]);
    }

    try {
      const callbackUrl = `https://ragaex.co/payping.php`;
      const gatewayCharge = getGatewayChargeIrt(lockedTx);
      if (gatewayCharge <= 0) {
        this.error.unprocessableEntity(['مبلغ قابل پرداخت از درگاه نامعتبر است']);
      }
      const result = await this.payping.paymentRequest(
        lockedTx.gateway.merchantId,
        gatewayCharge,
        lockedTx.id,
        callbackUrl,
      );

      await this.transactionRepository.update(transactionId, {
        randomToken: result.authority,
        payToken: (result as any)?.payToken || null,
        gatewayRedirectUrl: result.url,
        gatewaySessionStatus: GatewaySessionStatus.ready,
        gatewaySessionLeaseToken: null,
        gatewaySessionLeaseExpiresAt: null,
      });

      return { bankUrl: result.url };
    } catch (e) {
      await this.transactionRepository.update(transactionId, {
        gatewaySessionStatus: GatewaySessionStatus.uncertain,
        gatewaySessionLeaseToken: null,
        gatewaySessionLeaseExpiresAt: null,
        message: isPaypingPaymentRequestError(e)
          ? e.details.message
          : 'gateway_session_request_uncertain',
      });

      this.error.internalServerError([
        'اتصال به درگاه بانک برقرار نشد، لطفا مجدد تلاش کنید',
      ]);
    }
  }

  /**
   * --------------------------------------------------------
   */
  async verifyPayping(
    authority: string,
    referenceNumber: string,
    cardMask: string,
  ) {
    const transaction = await this.getTransactionByAuthority(authority);
    if (!transaction) {
      return `${this.config.app.siteBaseUrl}/payment?status=error&gateway=payping&code=404`;
    }

    const siteBaseUrl = this.generateSiteBaseUrl();

    if (transaction.status === TransactionStatus.paid) {
      return this.buildPaypingSuccessRedirect(transaction, referenceNumber);
    }

    if (transaction.status === TransactionStatus.provider_paid_superseded) {
      return `${siteBaseUrl}/payment?status=error&gateway=payping&code=506&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    if (transaction.status === TransactionStatus.superseded) {
      return `${siteBaseUrl}/payment?status=error&gateway=payping&code=504&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    try {
      this.rejectUnlessFin1SettlementEvidence(
        transaction,
        transaction.order ?? null,
      );
    } catch (err) {
      if (err?.status) {
        return `${siteBaseUrl}/payment?status=error&gateway=payping&code=507&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order?.number}`;
      }
      throw err;
    }

    if (!validatePaypingReferenceNumber(referenceNumber)) {
      return `${siteBaseUrl}/payment?status=error&gateway=payping&code=500&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    if (
      transaction.walletTRY &&
      transaction.walletTRY > transaction.customer.walletTRY
    ) {
      return `${siteBaseUrl}/payment?status=error&gateway=payping&code=500&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    if (
      transaction.walletIRT &&
      transaction.walletIRT > transaction.customer.walletIRT
    ) {
      return `${siteBaseUrl}/payment?status=error&gateway=payping&code=500&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    const verificationAuth = await this.markVerificationStarted(
      transaction.id,
      referenceNumber,
    );

    if (!isPaypingVerificationAuthorized(verificationAuth)) {
      if (
        verificationAuth === 'order_missing' ||
        verificationAuth === 'transaction_missing'
      ) {
        return `${this.config.app.siteBaseUrl}/payment?status=error&gateway=payping&code=404`;
      }

      if (verificationAuth === 'already_finalized') {
        const refreshed = await this.getTransactionByAuthority(authority);
        if (refreshed?.status === TransactionStatus.paid) {
          return this.buildPaypingSuccessRedirect(refreshed, referenceNumber);
        }
      }

      return `${siteBaseUrl}/payment?status=error&gateway=payping&code=504&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    let message: string;
    let providerOutcome: ReturnType<typeof classifyPaypingVerificationError> =
      'success';

    try {
      message = await this.payping.paymentVerification(
        transaction.gateway.merchantId,
        referenceNumber,
        getGatewayChargeIrt(transaction),
      );
    } catch (error) {
      providerOutcome = classifyPaypingVerificationError(error);
      const errorMessage = isPaypingVerificationError(error)
        ? JSON.stringify({
            kind: error.details.kind,
            providerResponseReceived: error.details.providerResponseReceived,
            httpStatus: error.details.httpStatus,
            providerErrorCode: error.details.providerErrorCode,
            axiosCode: error.details.axiosCode,
            isTimeout: error.details.isTimeout,
            isNetworkError: error.details.isNetworkError,
          })
        : 'payping_verification_uncertain';

      if (providerOutcome === 'definitive_failure') {
        await this.markTransactionFailedIfReconcilable(
          transaction.id,
          errorMessage,
          { referenceNumber, maskedCardNumber: cardMask },
        );
        return `${siteBaseUrl}/payment?status=error&gateway=payping&code=501&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
      }

      await this.markTransactionUncertain(
        transaction.id,
        errorMessage,
        referenceNumber,
      );

      if (providerOutcome === 'already_verified') {
        const recovery = await this.finalizeVerifiedPaymentAttempt(
          transaction,
          referenceNumber,
          cardMask,
          'تایید قبلی درگاه',
        );

        if (recovery === 'finalized' || recovery === 'idempotent') {
          return this.buildPaypingSuccessRedirect(
            { ...transaction, referenceNumber },
            referenceNumber,
          );
        }

        if (
          recovery === 'superseded' ||
          recovery === 'provider_paid_superseded'
        ) {
          return `${siteBaseUrl}/payment?status=error&gateway=payping&code=506&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
        }
      }

      return `${siteBaseUrl}/payment?status=error&gateway=payping&code=505&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    const finalizeResult = await this.finalizeVerifiedPaymentAttempt(
      transaction,
      referenceNumber,
      cardMask,
      message,
    );

    if (finalizeResult === 'finalized' || finalizeResult === 'idempotent') {
      return this.buildPaypingSuccessRedirect(
        { ...transaction, referenceNumber },
        referenceNumber,
      );
    }

    if (
      finalizeResult === 'superseded' ||
      finalizeResult === 'provider_paid_superseded'
    ) {
      return `${siteBaseUrl}/payment?status=error&gateway=payping&code=506&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    return `${siteBaseUrl}/payment?status=error&gateway=payping&code=503&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
  }

  private async finalizeVerifiedPaymentAttempt(
    transaction: TransactionEntity,
    referenceNumber: string,
    cardMask: string,
    message: string,
  ): Promise<
    | 'finalized'
    | 'idempotent'
    | 'superseded'
    | 'provider_paid_superseded'
    | 'failed'
  > {
    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let newlyPaid = false;
    let claim: 'claimed' | 'same_transaction' | 'other_transaction' = 'claimed';

    try {
      const lockedOrder = await queryRunner.manager.findOne(OrderEntity, {
        where: { id: transaction.orderId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!lockedOrder) {
        this.error.unprocessableEntity(['سفارش موردنظر پیدا نشد']);
      }

      const lockedTx = await queryRunner.manager.findOne(TransactionEntity, {
        where: { id: transaction.id },
        lock: { mode: 'pessimistic_write' },
      });

      if (lockedTx.status === TransactionStatus.paid) {
        await queryRunner.commitTransaction();
        return 'idempotent';
      }

      if (lockedTx.status === TransactionStatus.superseded) {
        await queryRunner.commitTransaction();
        return 'superseded';
      }

      const claimResult = await this.orderService.claimOrderPaymentFinalization(
        transaction.orderId,
        transaction.id,
        queryRunner,
      );
      claim = claimResult;

      if (claim === 'other_transaction') {
        const existingFinalization = await queryRunner.manager.findOne(
          OrderPaymentFinalizationEntity,
          { where: { orderId: transaction.orderId } },
        );

        await queryRunner.manager.update(
          TransactionEntity,
          { id: transaction.id },
          {
            status: TransactionStatus.provider_paid_superseded,
            referenceNumber,
            maskedCardNumber: cardMask,
            message: 'provider_paid_requires_manual_reconciliation',
            providerVerificationReference: referenceNumber,
            reconciliationWinningTransactionId:
              existingFinalization?.transactionId ?? null,
            reconciliationReason:
              'provider_success_after_order_finalized_by_other_transaction',
            reconciliationDetectedAt: new Date(),
            paidAt: new Date(),
          },
        );
        await queryRunner.commitTransaction();
        return 'provider_paid_superseded';
      }

      const shouldApplyWallet = claim === 'claimed';

      if (
        shouldApplyWallet &&
        (transaction.walletTRY > 0 || transaction.walletIRT > 0)
      ) {
        const walletUpdate = await queryRunner.manager
          .createQueryBuilder()
          .update(CustomerEntity)
          .set({
            ...(transaction.walletTRY > 0 && {
              walletTRY: () => 'walletTRY - :walletTRY',
            }),
            ...(transaction.walletIRT > 0 && {
              walletIRT: () => 'walletIRT - :walletIRT',
            }),
          })
          .setParameters({
            walletTRY: transaction.walletTRY,
            walletIRT: transaction.walletIRT,
          })
          .where(
            'id = :id' +
              (transaction.walletTRY > 0
                ? ' AND walletTRY >= :walletTRY'
                : '') +
              (transaction.walletIRT > 0 ? ' AND walletIRT >= :walletIRT' : ''),
            {
              id: transaction.customerId,
              walletTRY: transaction.walletTRY,
              walletIRT: transaction.walletIRT,
            },
          )
          .execute();

        if (walletUpdate.affected === 0) {
          this.error.unprocessableEntity(['موجودی کیف پول کافی نمی‌باشد']);
        }

        if (transaction.walletTRY > 0) {
          await queryRunner.manager
            .createQueryBuilder()
            .insert()
            .into('wallet_history')
            .values({
              customerId: transaction.customerId,
              walletTRY: -1 * transaction.walletTRY,
              type: WalletHistoryType.buy,
              relatedOrderId: transaction.orderId,
              createdAt: new Date(),
            })
            .execute();
        }
        if (transaction.walletIRT > 0) {
          await queryRunner.manager
            .createQueryBuilder()
            .insert()
            .into('wallet_history')
            .values({
              customerId: transaction.customerId,
              walletIRT: -1 * transaction.walletIRT,
              type: WalletHistoryType.buy,
              relatedOrderId: transaction.orderId,
              createdAt: new Date(),
            })
            .execute();
        }
      }

      const updateResult = await queryRunner.manager
        .createQueryBuilder()
        .update(TransactionEntity)
        .set({
          referenceNumber,
          maskedCardNumber: cardMask,
          message,
          paidAt: new Date(),
          status: TransactionStatus.paid,
          providerVerificationReference: referenceNumber,
        })
        .where('id = :id AND status IN (:...statuses)', {
          id: transaction.id,
          statuses: RECONCILABLE_TRANSACTION_STATUSES,
        })
        .execute();

      if (updateResult.affected === 0) {
        await queryRunner.rollbackTransaction();
        const current = await this.transactionRepository.findOne({
          where: { id: transaction.id },
        });
        if (current?.status === TransactionStatus.paid) {
          return 'idempotent';
        }
        if (current?.status === TransactionStatus.superseded) {
          return 'superseded';
        }
        return 'failed';
      }

      const paymentResult = await this.orderService.markOrderPaidAtomic(
        transaction.orderId,
        queryRunner,
        transaction.id,
      );

      if (paymentResult !== 'newly_paid' && paymentResult !== 'already_paid') {
        this.error.unprocessableEntity(['این سفارش قابل پرداخت نمی‌باشد']);
      }

      if (paymentResult === 'newly_paid' && claim === 'claimed') {
        await this.orderService.recognizeCogsFromOrderItemSnapshots(
          transaction.orderId,
          queryRunner,
        );
        await this.orderService.applyReferralRewardsAtomic(
          transaction.orderId,
          queryRunner,
        );
        newlyPaid = true;
      }

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();

      await this.markTransactionUncertain(
        transaction.id,
        'local_finalization_failed',
        referenceNumber,
      );

      return 'failed';
    } finally {
      await queryRunner.release();
    }

    if (newlyPaid) {
      await notifyPostPaymentBestEffort(this.orderService, transaction.orderId);
    }

    if (claim === 'same_transaction') {
      return 'idempotent';
    }

    return newlyPaid ? 'finalized' : 'idempotent';
  }

  private buildPaypingSuccessRedirect(
    transaction: Pick<
      TransactionEntity,
      'orderId' | 'id' | 'amount' | 'createdAt' | 'referenceNumber'
    > & { order?: { number: string } },
    referenceNumber: string,
  ) {
    const siteBaseUrl = this.generateSiteBaseUrl();

    return `${siteBaseUrl}/payment?status=success&gateway=payping&code=200&order_id=${
      transaction.orderId
    }&order_number=${transaction.order?.number || ''}&transaction_id=${
      transaction.id
    }&number=${transaction.referenceNumber || referenceNumber}&amount=${
      transaction.amount
    }&date=${moment(transaction.createdAt).format(
      'YYYY-MM-DD',
    )}&message=پرداخت با موفقیت انجام شد`;
  }

  /**
   * Authorize (and mark) provider verification under Order → Transaction locks.
   *
   * Provider verification may begin only when the result is `started` or
   * `already_started`. Silent no-op is intentionally not used.
   */
  private async markVerificationStarted(
    id: number,
    referenceNumber: string,
  ): Promise<PaypingVerificationStartResult> {
    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Non-authoritative lookup only to discover orderId.
      const existing = await queryRunner.manager.findOne(TransactionEntity, {
        where: { id },
      });
      if (!existing) {
        await queryRunner.commitTransaction();
        return 'transaction_missing';
      }

      // Lock order first (same order as OrderService delete/reject/release).
      const lockedOrder = await queryRunner.manager.findOne(OrderEntity, {
        where: { id: existing.orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedOrder) {
        await queryRunner.commitTransaction();
        return 'order_missing';
      }

      const lockedTx = await queryRunner.manager.findOne(TransactionEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedTx) {
        await queryRunner.commitTransaction();
        return 'transaction_missing';
      }

      if (lockedTx.orderId !== lockedOrder.id) {
        await queryRunner.commitTransaction();
        return 'transaction_not_eligible';
      }

      const finalization = await queryRunner.manager.findOne(
        OrderPaymentFinalizationEntity,
        { where: { orderId: lockedOrder.id } },
      );

      if (
        isOrderAlreadyPaid(lockedOrder.status) ||
        lockedOrder.successfulTransactionId != null ||
        !!finalization ||
        lockedTx.status === TransactionStatus.paid ||
        lockedTx.status === TransactionStatus.provider_paid_superseded
      ) {
        await queryRunner.commitTransaction();
        return 'already_finalized';
      }

      // Reservation must still be owned (pending) or verification is prohibited.
      if (!isOrderPaymentInitiatable(lockedOrder.status)) {
        await queryRunner.commitTransaction();
        return 'not_payable';
      }

      if (lockedTx.status === TransactionStatus.verification_started) {
        if (referenceNumber) {
          lockedTx.providerVerificationReference = referenceNumber;
          await queryRunner.manager.save(lockedTx);
        }
        await queryRunner.commitTransaction();
        return 'already_started';
      }

      if (
        lockedTx.status !== TransactionStatus.pending &&
        lockedTx.status !== TransactionStatus.verification_uncertain
      ) {
        await queryRunner.commitTransaction();
        return 'transaction_not_eligible';
      }

      lockedTx.status = TransactionStatus.verification_started;
      lockedTx.verificationStartedAt = new Date();
      lockedTx.providerVerificationReference = referenceNumber;
      await queryRunner.manager.save(lockedTx);
      await queryRunner.commitTransaction();
      return 'started';
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  private async markTransactionUncertain(
    id: number,
    message: string,
    referenceNumber?: string,
  ) {
    await this.transactionRepository
      .createQueryBuilder()
      .update()
      .set({
        message,
        status: TransactionStatus.verification_uncertain,
        ...(referenceNumber && {
          providerVerificationReference: referenceNumber,
        }),
      })
      .where('id = :id AND status IN (:...statuses)', {
        id,
        statuses: RECONCILABLE_TRANSACTION_STATUSES,
      })
      .execute();
  }

  private async markTransactionFailedIfReconcilable(
    id: number,
    message: string,
    extra: Partial<TransactionEntity> = {},
  ) {
    await this.transactionRepository
      .createQueryBuilder()
      .update()
      .set({
        ...extra,
        message,
        status: TransactionStatus.failed,
      })
      .where('id = :id AND status IN (:...statuses)', {
        id,
        statuses: RECONCILABLE_TRANSACTION_STATUSES,
      })
      .execute();
  }

  /**
   * --------------------------------------------------------
   */
  private generateSiteBaseUrl() {
    return 'https://ragashop.co';
  }

  /**
   * --------------------------------------------------------
   */
  private async update(id: number, data) {
    await this.transactionRepository
      .createQueryBuilder()
      .update()
      .set(data)
      .where({ id })
      .execute();
  }

  /**
   * --------------------------------------------------------
   */
  private async _generateCode(length = 14) {
    while (true) {
      const newToken = generateRandomDigitCode(length);
      if (newToken.charAt(0) === '0') continue;

      const count = await this.transactionRepository.count({
        randomToken: newToken,
      });
      if (count === 0) {
        return newToken;
      }
    }
  }
}
