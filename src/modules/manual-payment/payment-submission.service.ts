import { Injectable, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { getConnection, QueryRunner, Repository } from 'typeorm';
import { ErrorService } from '../../error/error.service';
import { OrderService } from '../order/order.service';
import { OrderEntity } from '../order/entities/order.entity';
import { OrderPaymentFinalizationEntity } from '../order/entities/order-payment-finalization.entity';
import {
  isOrderAlreadyPaid,
  isOrderPaymentInitiatable,
} from '../order/utils/order-payable-states';
import { SettingEntity } from '../setting/entities/setting.entity';
import { computeSettlementFromOrderSnapshot } from '../finance/settlement-money';
import {
  TransactionEntity,
  TransactionPaymentSource,
  TransactionStatus,
} from '../transaction/entities/transaction.entity';
import { ProductCurrency } from '../product/entities/product.entity';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  paginationResult,
} from '../../utils';
import { PaymentSubmissionEntity } from './entities/payment-submission.entity';
import { PaymentEvidenceEntity } from './entities/payment-evidence.entity';
import { PaymentReviewEventEntity } from './entities/payment-review-event.entity';
import { PrivateReceiptObjectEntity } from './entities/private-receipt-object.entity';
import { BankDestinationService } from './bank-destination.service';
import { ManualPaymentMethodService } from './manual-payment-method.service';
import { PrivateReceiptStorageService } from './private-receipt-storage.service';
import { UserCapabilityService } from './user-capability.service';
import {
  ManualPaymentRail,
  PaymentRejectionReasonCode,
  PaymentSubmissionPurpose,
  PaymentSubmissionStatus,
  UserCapabilityName,
  ACTIVE_MANUAL_PAYMENT_HOLD_STATUSES,
  resolveTimingHours,
} from './manual-payment.types';
import {
  addHours,
  amountsMatch,
  buildActiveLockKey,
  hasActiveOrderPaymentHold,
  normalizeBankReference,
} from './utils/manual-payment.helpers';

/**
 * C2A lock order (must match C1 OrderService.delete / tryReleasePendingInventory):
 *   1. Order row pessimistic_write FIRST
 *   2. Then payment_submission / related rows as needed
 * Never lock submission before Order when both are needed for create/resubmit.
 */
@Injectable()
export class PaymentSubmissionService {
  constructor(
    @InjectRepository(PaymentSubmissionEntity)
    private readonly submissionRepository: Repository<PaymentSubmissionEntity>,
    @InjectRepository(PaymentEvidenceEntity)
    private readonly evidenceRepository: Repository<PaymentEvidenceEntity>,
    @InjectRepository(PaymentReviewEventEntity)
    private readonly reviewEventRepository: Repository<PaymentReviewEventEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(SettingEntity)
    private readonly settingRepository: Repository<SettingEntity>,
    private readonly bankDestinationService: BankDestinationService,
    private readonly methodService: ManualPaymentMethodService,
    private readonly receiptStorage: PrivateReceiptStorageService,
    private readonly capabilityService: UserCapabilityService,
    @Inject(forwardRef(() => OrderService))
    private readonly orderService: OrderService,
    private readonly error: ErrorService,
  ) {}

  async findActiveHoldForOrder(
    orderId: number,
    now: Date = new Date(),
  ): Promise<PaymentSubmissionEntity | null> {
    const rows = await this.submissionRepository
      .createQueryBuilder('ps')
      .where('ps.orderId = :orderId', { orderId })
      .andWhere('ps.purpose = :purpose', {
        purpose: PaymentSubmissionPurpose.ORDER_PAYMENT,
      })
      .andWhere('ps.status IN (:...statuses)', {
        statuses: ACTIVE_MANUAL_PAYMENT_HOLD_STATUSES,
      })
      .andWhere('ps.holdExpiresAt > :now', { now })
      .orderBy('ps.id', 'DESC')
      .getMany();

    return rows.find((r) => hasActiveOrderPaymentHold(r, now)) || null;
  }

  async orderHasActiveManualPaymentHold(orderId: number): Promise<boolean> {
    return !!(await this.findActiveHoldForOrder(orderId));
  }

  async getTransferInstructions(orderId: number, customerId: number) {
    const order = await this.requireCustomerOrder(orderId, customerId);
    this.assertOrderEligibleForManualPayment(order);

    const settlement = this.settlementFromOrderOrThrow(order);
    const setting = await this.getSettings();
    const methods = await this.methodService.listEnabledForCustomer({
      amountIrt: settlement.settlementAmount,
    });
    const destinations = await this.bankDestinationService.listForCustomer({
      amountIrt: settlement.settlementAmount,
    });

    const active = await this.findActiveHoldForOrder(orderId);
    const latest = await this.submissionRepository.findOne({
      where: {
        orderId,
        customerId,
        purpose: PaymentSubmissionPurpose.ORDER_PAYMENT,
      },
      order: { id: 'DESC' },
    });

    return {
      orderId: order.id,
      expectedAmount: settlement.settlementAmount,
      expectedCurrency: ProductCurrency.IRT,
      commercialAmount: settlement.commercialAmount,
      commercialCurrency: settlement.commercialCurrency,
      fxRateToIrt: settlement.fxRateToIrt,
      submitDeadlineHours: resolveTimingHours(
        setting.manualPaymentSubmitDeadlineHours,
        'submitDeadlineHours',
      ),
      reviewHoldHours: resolveTimingHours(
        setting.manualPaymentReviewHoldHours,
        'reviewHoldHours',
      ),
      resubmitGraceHours: resolveTimingHours(
        setting.manualPaymentResubmitGraceHours,
        'resubmitGraceHours',
      ),
      methods,
      destinations,
      activeSubmission: active,
      latestSubmission: latest,
    };
  }

  /**
   * Create submission under Order lock (C1-compatible lock order).
   * Pattern: optional light precheck → storeBuffer → BEGIN; lock Order;
   * full revalidate; expire holds; insert; COMMIT. On fail after store:
   * rollback + deleteOrphanReceipt.
   */
  async createSubmissionWithEvidence(params: {
    orderId: number;
    customerId: number;
    rail: ManualPaymentRail;
    bankDestinationId: number;
    file: Express.Multer.File;
    submittedAmount?: number | null;
    bankReference?: string | null;
    payerName?: string | null;
    customerNote?: string | null;
    idempotencyKey: string;
  }) {
    const existingByKey = await this.findOwnedByIdempotency({
      idempotencyKey: params.idempotencyKey,
      customerId: params.customerId,
      orderId: params.orderId,
    });
    if (existingByKey) {
      return this.toSubmissionDetail(existingByKey);
    }

    // Light precheck (not authoritative — revalidated under Order lock).
    const preOrder = await this.requireCustomerOrder(
      params.orderId,
      params.customerId,
    );
    this.assertOrderEligibleForManualPayment(preOrder);

    const setting = await this.getSettings();
    const now = new Date();
    const submitDeadlineHours = resolveTimingHours(
      setting.manualPaymentSubmitDeadlineHours,
      'submitDeadlineHours',
    );
    const reviewHoldHours = resolveTimingHours(
      setting.manualPaymentReviewHoldHours,
      'reviewHoldHours',
    );

    const method = await this.methodService.getByRail(params.rail);
    if (!method.enabled) {
      this.error.unprocessableEntity(['این روش پرداخت غیرفعال است']);
    }

    const settlement = this.settlementFromOrderOrThrow(preOrder);
    if (
      !this.methodService.amountWithinLimits(
        method,
        settlement.settlementAmount,
      )
    ) {
      this.error.unprocessableEntity([
        'مبلغ سفارش خارج از محدوده روش پرداخت است',
      ]);
    }

    const destination = await this.bankDestinationService.getById(
      params.bankDestinationId,
    );
    if (!destination.enabled) {
      this.error.unprocessableEntity(['مقصد بانکی غیرفعال است']);
    }
    this.bankDestinationService.assertRailCompatibility(
      destination,
      params.rail,
    );
    if (
      !this.bankDestinationService.amountWithinLimits(
        destination,
        settlement.settlementAmount,
      )
    ) {
      this.error.unprocessableEntity([
        'مبلغ سفارش خارج از محدوده مقصد بانکی است',
      ]);
    }

    const receipt = await this.receiptStorage.storeBuffer({
      buffer: params.file.buffer,
      originalFilename: params.file.originalname,
      mimeType: params.file.mimetype,
      customerId: params.customerId,
    });

    const holdExpiresAt = addHours(now, reviewHoldHours);

    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Lock order: Order pessimistic_write FIRST (matches C1).
      const order = await queryRunner.manager.findOne(OrderEntity, {
        where: { id: params.orderId, customerId: params.customerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) {
        this.error.unprocessableEntity(['سفارش یافت نشد']);
      }

      await this.assertOrderEligibleLocked(queryRunner, order, now, {
        submitDeadlineHours,
      });

      await this.expireExpiredHoldsForOrderUnderLock(
        queryRunner,
        params.orderId,
        now,
      );

      const active = await this.findActiveHoldUnderLock(
        queryRunner,
        params.orderId,
        now,
      );
      if (active) {
        this.error.unprocessableEntity([
          'برای این سفارش یک رسید در حال بررسی وجود دارد',
        ]);
      }

      // Re-check method/destination limits against settlement under lock.
      const lockedSettlement = this.settlementFromOrderOrThrow(order);
      if (
        !this.methodService.amountWithinLimits(
          method,
          lockedSettlement.settlementAmount,
        ) ||
        !this.bankDestinationService.amountWithinLimits(
          destination,
          lockedSettlement.settlementAmount,
        )
      ) {
        this.error.unprocessableEntity([
          'مبلغ سفارش خارج از محدوده مجاز است',
        ]);
      }

      const { identifiers } = await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(PaymentSubmissionEntity)
        .values({
          purpose: PaymentSubmissionPurpose.ORDER_PAYMENT,
          customerId: params.customerId,
          orderId: params.orderId,
          rail: params.rail,
          bankDestinationId: destination.id,
          destinationBankName: destination.bankName,
          destinationAccountHolderName: destination.accountHolderName,
          destinationCardNumber: destination.cardNumber,
          destinationIban: destination.iban,
          destinationAccountNumber: destination.accountNumber,
          expectedAmount: lockedSettlement.settlementAmount,
          expectedCurrency: ProductCurrency.IRT,
          status: PaymentSubmissionStatus.SUBMITTED,
          holdExpiresAt,
          idempotencyKey: params.idempotencyKey,
          activeLockKey: buildActiveLockKey(params.orderId),
          createdAt: now,
          updatedAt: now,
        })
        .execute();

      const submissionId = identifiers[0].id;

      const evidenceInsert = await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(PaymentEvidenceEntity)
        .values({
          submissionId,
          attemptNo: 1,
          receiptObjectId: receipt.id,
          submittedAmount: params.submittedAmount ?? null,
          submittedCurrency: ProductCurrency.IRT,
          bankReference: params.bankReference ?? null,
          bankReferenceNormalized: normalizeBankReference(params.bankReference),
          payerName: params.payerName ?? null,
          customerNote: params.customerNote ?? null,
          contentSha256: receipt.sha256,
          submittedAt: now,
        })
        .execute();

      const evidenceId = evidenceInsert.identifiers[0].id;

      await queryRunner.manager
        .createQueryBuilder()
        .update(PaymentSubmissionEntity)
        .set({ activeEvidenceId: evidenceId, updatedAt: now })
        .where('id = :id', { id: submissionId })
        .execute();

      await this.appendReviewEvent(queryRunner, {
        submissionId,
        actorCustomerId: params.customerId,
        action: 'SUBMIT',
        fromStatus: null,
        toStatus: PaymentSubmissionStatus.SUBMITTED,
        metadataJson: { attemptNo: 1, evidenceId },
      });

      await queryRunner.commitTransaction();

      const submission = await this.submissionRepository.findOne({
        where: { id: submissionId },
      });
      return this.toSubmissionDetail(submission);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      await this.receiptStorage.deleteOrphanReceipt(receipt);
      if (err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062) {
        const byKey = await this.findOwnedByIdempotency({
          idempotencyKey: params.idempotencyKey,
          customerId: params.customerId,
          orderId: params.orderId,
        });
        if (byKey) {
          return this.toSubmissionDetail(byKey);
        }
        // Same raw key owned by another customer/order — do not leak.
        this.error.unprocessableEntity(['درخواست نامعتبر']);
      }
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Resubmit under Order lock first, then submission row lock (C1-compatible).
   */
  async resubmit(params: {
    submissionId: number;
    customerId: number;
    file: Express.Multer.File;
    submittedAmount?: number | null;
    bankReference?: string | null;
    payerName?: string | null;
    customerNote?: string | null;
  }) {
    const preSubmission = await this.submissionRepository.findOne({
      where: { id: params.submissionId, customerId: params.customerId },
    });
    if (!preSubmission) {
      this.error.unprocessableEntity(['ارسال پرداخت یافت نشد']);
    }
    if (preSubmission.status !== PaymentSubmissionStatus.REJECTED) {
      this.error.unprocessableEntity([
        'فقط ارسال‌های ردشده قابل ارسال مجدد هستند',
      ]);
    }

    const preOrder = await this.requireCustomerOrder(
      preSubmission.orderId,
      params.customerId,
    );
    this.assertOrderEligibleForManualPayment(preOrder);

    const setting = await this.getSettings();
    const now = new Date();
    const graceHours = resolveTimingHours(
      setting.manualPaymentResubmitGraceHours,
      'resubmitGraceHours',
    );
    const reviewHoldHours = resolveTimingHours(
      setting.manualPaymentReviewHoldHours,
      'reviewHoldHours',
    );
    const submitDeadlineHours = resolveTimingHours(
      setting.manualPaymentSubmitDeadlineHours,
      'submitDeadlineHours',
    );

    if (preSubmission.reviewedAt) {
      const graceEnds = addHours(new Date(preSubmission.reviewedAt), graceHours);
      if (now > graceEnds) {
        this.error.unprocessableEntity([
          'مهلت ارسال مجدد رسید به پایان رسیده است',
        ]);
      }
    }

    const lastAttempt = await this.evidenceRepository
      .createQueryBuilder('e')
      .where('e.submissionId = :id', { id: preSubmission.id })
      .orderBy('e.attemptNo', 'DESC')
      .getOne();
    const nextAttempt = (lastAttempt?.attemptNo || 0) + 1;

    const receipt = await this.receiptStorage.storeBuffer({
      buffer: params.file.buffer,
      originalFilename: params.file.originalname,
      mimeType: params.file.mimetype,
      customerId: params.customerId,
    });

    const holdExpiresAt = addHours(now, reviewHoldHours);

    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Lock order: Order FIRST, then submission.
      const order = await queryRunner.manager.findOne(OrderEntity, {
        where: {
          id: preSubmission.orderId,
          customerId: params.customerId,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) {
        this.error.unprocessableEntity(['سفارش یافت نشد']);
      }

      await this.assertOrderEligibleLocked(queryRunner, order, now, {
        submitDeadlineHours,
      });

      await this.expireExpiredHoldsForOrderUnderLock(
        queryRunner,
        preSubmission.orderId,
        now,
      );

      const locked = await queryRunner.manager.findOne(PaymentSubmissionEntity, {
        where: { id: preSubmission.id, customerId: params.customerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status !== PaymentSubmissionStatus.REJECTED) {
        this.error.unprocessableEntity(['وضعیت ارسال تغییر کرده است']);
      }

      if (locked.reviewedAt) {
        const graceEnds = addHours(new Date(locked.reviewedAt), graceHours);
        if (now > graceEnds) {
          this.error.unprocessableEntity([
            'مهلت ارسال مجدد رسید به پایان رسیده است',
          ]);
        }
      }

      const otherActive = await this.findActiveHoldUnderLock(
        queryRunner,
        locked.orderId,
        now,
      );
      if (otherActive && otherActive.id !== locked.id) {
        this.error.unprocessableEntity([
          'برای این سفارش یک رسید در حال بررسی وجود دارد',
        ]);
      }

      const evidenceInsert = await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(PaymentEvidenceEntity)
        .values({
          submissionId: locked.id,
          attemptNo: nextAttempt,
          receiptObjectId: receipt.id,
          submittedAmount: params.submittedAmount ?? null,
          submittedCurrency: ProductCurrency.IRT,
          bankReference: params.bankReference ?? null,
          bankReferenceNormalized: normalizeBankReference(params.bankReference),
          payerName: params.payerName ?? null,
          customerNote: params.customerNote ?? null,
          contentSha256: receipt.sha256,
          submittedAt: now,
        })
        .execute();

      const evidenceId = evidenceInsert.identifiers[0].id;

      await queryRunner.manager
        .createQueryBuilder()
        .update(PaymentSubmissionEntity)
        .set({
          status: PaymentSubmissionStatus.SUBMITTED,
          activeEvidenceId: evidenceId,
          holdExpiresAt,
          activeLockKey: buildActiveLockKey(locked.orderId),
          rejectionReasonCode: null,
          rejectionReasonText: null,
          claimedAt: null,
          claimedByUserId: null,
          reviewedAt: null,
          reviewedByUserId: null,
          updatedAt: now,
        })
        .where('id = :id', { id: locked.id })
        .execute();

      await this.appendReviewEvent(queryRunner, {
        submissionId: locked.id,
        actorCustomerId: params.customerId,
        action: 'RESUBMIT',
        fromStatus: PaymentSubmissionStatus.REJECTED,
        toStatus: PaymentSubmissionStatus.SUBMITTED,
        metadataJson: { attemptNo: nextAttempt, evidenceId },
      });

      await queryRunner.commitTransaction();

      const updated = await this.submissionRepository.findOne({
        where: { id: locked.id },
      });
      return this.toSubmissionDetail(updated);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      await this.receiptStorage.deleteOrphanReceipt(receipt);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async getStatusForCustomer(orderId: number, customerId: number) {
    await this.requireCustomerOrder(orderId, customerId);
    const submission = await this.submissionRepository.findOne({
      where: {
        orderId,
        customerId,
        purpose: PaymentSubmissionPurpose.ORDER_PAYMENT,
      },
      order: { id: 'DESC' },
    });
    if (!submission) {
      return null;
    }
    return this.toSubmissionDetail(submission);
  }

  async getSubmissionByIdForCustomer(id: number, customerId: number) {
    const submission = await this.submissionRepository.findOne({
      where: { id, customerId },
    });
    if (!submission) {
      this.error.unprocessableEntity(['ارسال پرداخت یافت نشد']);
    }
    return this.toSubmissionDetail(submission);
  }

  async listAdmin(
    page = 1,
    limit = 20,
    filters = null,
    sorts = null,
  ) {
    let builder = this.submissionRepository.createQueryBuilder('ps');

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('ps.id', 'DESC');
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

  async getAdminDetail(id: number) {
    const submission = await this.submissionRepository.findOne({
      where: { id },
    });
    if (!submission) {
      this.error.unprocessableEntity(['ارسال پرداخت یافت نشد']);
    }

    const evidence = await this.evidenceRepository.find({
      where: { submissionId: id },
      order: { attemptNo: 'ASC' },
    });
    const events = await this.reviewEventRepository.find({
      where: { submissionId: id },
      order: { id: 'ASC' },
    });

    let duplicateWarning: null | {
      previousSubmissionId: number;
      bankReferenceNormalized: string;
    } = null;

    const activeEvidence = evidence.find(
      (e) => e.id === submission.activeEvidenceId,
    );
    if (activeEvidence?.bankReferenceNormalized) {
      const dup = await this.evidenceRepository
        .createQueryBuilder('e')
        .innerJoin(
          PaymentSubmissionEntity,
          'ps',
          'ps.id = e.submissionId',
        )
        .where('e.bankReferenceNormalized = :ref', {
          ref: activeEvidence.bankReferenceNormalized,
        })
        .andWhere('ps.rail = :rail', { rail: submission.rail })
        .andWhere('ps.status = :status', {
          status: PaymentSubmissionStatus.APPROVED,
        })
        .andWhere('ps.id != :id', { id: submission.id })
        .orderBy('ps.id', 'DESC')
        .getOne();

      if (dup) {
        duplicateWarning = {
          previousSubmissionId: dup.submissionId,
          bankReferenceNormalized: activeEvidence.bankReferenceNormalized,
        };
      }
    }

    return {
      submission,
      evidence,
      events,
      duplicateWarning,
    };
  }

  async claim(submissionId: number, user: { id: number; role: string }) {
    await this.capabilityService.assertUserHasCapability(
      user,
      UserCapabilityName.payment_submission_review,
      this.error,
    );

    // Durable expire in its own TX before claim business logic.
    const didExpire = await this.expireSubmissionIfNeededDurable(submissionId);
    if (didExpire) {
      this.error.unprocessableEntity([
        'مهلت بررسی این ارسال به پایان رسیده است',
      ]);
    }

    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const submission = await queryRunner.manager.findOne(
        PaymentSubmissionEntity,
        {
          where: { id: submissionId },
          lock: { mode: 'pessimistic_write' },
        },
      );
      if (!submission) {
        this.error.unprocessableEntity(['ارسال پرداخت یافت نشد']);
      }

      if (
        submission.status !== PaymentSubmissionStatus.SUBMITTED &&
        submission.status !== PaymentSubmissionStatus.UNDER_REVIEW
      ) {
        this.error.unprocessableEntity(['این ارسال قابل ادعا نیست']);
      }

      const now = new Date();
      const from = submission.status;
      submission.status = PaymentSubmissionStatus.UNDER_REVIEW;
      submission.claimedAt = now;
      submission.claimedByUserId = user.id;
      submission.updatedAt = now;
      await queryRunner.manager.save(submission);

      await this.appendReviewEvent(queryRunner, {
        submissionId,
        actorUserId: user.id,
        action: 'CLAIM',
        fromStatus: from,
        toStatus: PaymentSubmissionStatus.UNDER_REVIEW,
      });

      await queryRunner.commitTransaction();
      return submission;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async approveAtomic(
    submissionId: number,
    user: { id: number; role: string },
    opts: { amountMismatchOverrideReason?: string | null } = {},
  ): Promise<{
    result: 'approved' | 'idempotent' | 'cancelled_paid_elsewhere';
    submission: PaymentSubmissionEntity;
  }> {
    await this.capabilityService.assertUserHasCapability(
      user,
      UserCapabilityName.payment_submission_approve,
      this.error,
    );

    const existing = await this.submissionRepository.findOne({
      where: { id: submissionId },
    });
    if (!existing) {
      this.error.unprocessableEntity(['ارسال پرداخت یافت نشد']);
    }
    if (existing.status !== PaymentSubmissionStatus.APPROVED) {
      const didExpire =
        await this.expireSubmissionIfNeededDurable(submissionId);
      if (didExpire) {
        this.error.unprocessableEntity([
          'مهلت بررسی این ارسال به پایان رسیده است',
        ]);
      }
    }

    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let notifyOrderId: number | null = null;
    let result: {
      result: 'approved' | 'idempotent' | 'cancelled_paid_elsewhere';
      submission: PaymentSubmissionEntity;
    };

    try {
      const submission = await queryRunner.manager.findOne(
        PaymentSubmissionEntity,
        {
          where: { id: submissionId },
          lock: { mode: 'pessimistic_write' },
        },
      );
      if (!submission) {
        this.error.unprocessableEntity(['ارسال پرداخت یافت نشد']);
      }

      if (submission.status === PaymentSubmissionStatus.APPROVED) {
        result = { result: 'idempotent', submission };
        await queryRunner.commitTransaction();
      } else {
        if (
          submission.status !== PaymentSubmissionStatus.SUBMITTED &&
          submission.status !== PaymentSubmissionStatus.UNDER_REVIEW
        ) {
          this.error.unprocessableEntity(['این ارسال قابل تایید نیست']);
        }

        const order = await queryRunner.manager.findOne(OrderEntity, {
          where: { id: submission.orderId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!order) {
          this.error.unprocessableEntity(['سفارش یافت نشد']);
        }
        if (order.customerId !== submission.customerId) {
          this.error.unprocessableEntity(['مالکیت سفارش نامعتبر است']);
        }

        const evidence = submission.activeEvidenceId
          ? await queryRunner.manager.findOne(PaymentEvidenceEntity, {
              where: { id: submission.activeEvidenceId },
            })
          : null;

        if (
          evidence &&
          !amountsMatch(evidence.submittedAmount, submission.expectedAmount)
        ) {
          if (!opts.amountMismatchOverrideReason?.trim()) {
            this.error.unprocessableEntity(
              ['برای تایید مبلغ مغایر، دلیل الزامی است'],
              { code: 'amount_mismatch_override_required' },
            );
          }
          submission.amountMismatchOverrideReason =
            opts.amountMismatchOverrideReason.trim();
        }

        // Settlement from Order FX snapshot only — never TGJU.
        let settlement;
        try {
          settlement = computeSettlementFromOrderSnapshot(order);
        } catch (e) {
          if (e?.message === 'order_fx_snapshot_missing') {
            this.error.unprocessableEntity(
              ['نرخ ارز سفارش موجود نیست. امکان تایید وجود ندارد.'],
              { code: 'order_fx_snapshot_missing' },
            );
          }
          throw e;
        }

        if (
          Math.round(settlement.settlementAmount) !==
          Math.round(Number(submission.expectedAmount))
        ) {
          this.error.unprocessableEntity([
            'مبلغ مورد انتظار با اسنپ‌شات سفارش همخوانی ندارد',
          ]);
        }

        const now = new Date();
        const { identifiers } = await queryRunner.manager
          .createQueryBuilder()
          .insert()
          .into(TransactionEntity)
          .values({
            orderId: order.id,
            customerId: order.customerId,
            gatewayId: null,
            amount: settlement.settlementAmount,
            settlementCurrency: settlement.settlementCurrency,
            fxRateToIrt: settlement.fxRateToIrt,
            commercialAmount: settlement.commercialAmount,
            commercialCurrency: settlement.commercialCurrency,
            walletAmount: 0,
            walletIRT: 0,
            walletTRY: 0,
            walletUSD: 0,
            reduceCardAmount: 0,
            status: TransactionStatus.paid,
            paymentSource: TransactionPaymentSource.manual,
            paymentSubmissionId: submission.id,
            manualRail: submission.rail,
            referenceNumber:
              evidence?.bankReferenceNormalized ||
              `MANUAL-SUB-${submission.id}-${Date.now()}`,
            message: 'manual_payment_submission_approved',
            paidAt: now,
            ip: '127.0.0.1',
            createdAt: now,
          })
          .execute();

        const transactionId = identifiers[0].id;

        const finalizeResult =
          await this.orderService.finalizeOrderPaymentAtomic(
            order.id,
            transactionId,
            queryRunner,
          );

        const fromStatus = submission.status;

        if (finalizeResult === 'superseded') {
          // Losing attempt must not remain a financially-winning paid tx.
          const existingFinalization = await queryRunner.manager.findOne(
            OrderPaymentFinalizationEntity,
            { where: { orderId: order.id } },
          );
          await queryRunner.manager.update(
            TransactionEntity,
            { id: transactionId },
            {
              status: TransactionStatus.superseded,
              paidAt: null,
              message: 'manual_approval_superseded_order_paid_elsewhere',
              reconciliationWinningTransactionId:
                existingFinalization?.transactionId ?? null,
              reconciliationReason:
                'manual_approval_after_order_finalized_by_other_transaction',
              reconciliationDetectedAt: now,
            },
          );

          submission.status = PaymentSubmissionStatus.CANCELLED;
          submission.activeLockKey = null;
          submission.updatedAt = now;
          submission.reviewedAt = now;
          submission.reviewedByUserId = user.id;
          submission.transactionId = transactionId;
          await queryRunner.manager.save(submission);

          await this.appendReviewEvent(queryRunner, {
            submissionId,
            actorUserId: user.id,
            action: 'CANCEL_PAID_ELSEWHERE',
            fromStatus,
            toStatus: PaymentSubmissionStatus.CANCELLED,
            metadataJson: { transactionId, finalizeResult },
          });

          result = { result: 'cancelled_paid_elsewhere', submission };
          await queryRunner.commitTransaction();
        } else {
          submission.status = PaymentSubmissionStatus.APPROVED;
          submission.activeLockKey = null;
          submission.transactionId = transactionId;
          submission.reviewedAt = now;
          submission.reviewedByUserId = user.id;
          submission.updatedAt = now;
          await queryRunner.manager.save(submission);

          await this.appendReviewEvent(queryRunner, {
            submissionId,
            actorUserId: user.id,
            action: 'APPROVE',
            fromStatus,
            toStatus: PaymentSubmissionStatus.APPROVED,
            metadataJson: {
              transactionId,
              finalizeResult,
              amountMismatchOverrideReason:
                submission.amountMismatchOverrideReason,
            },
          });

          result = {
            result:
              finalizeResult === 'idempotent' ? 'idempotent' : 'approved',
            submission,
          };
          await queryRunner.commitTransaction();
          if (finalizeResult === 'finalized') {
            notifyOrderId = order.id;
          }
        }
      }
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    if (notifyOrderId != null) {
      await this.orderService.sendPostPaymentNotifications(notifyOrderId);
    }

    return result;
  }

  async reject(
    submissionId: number,
    user: { id: number; role: string },
    dto: {
      rejectionReasonCode: PaymentRejectionReasonCode | string;
      rejectionReasonText?: string | null;
    },
  ) {
    await this.capabilityService.assertUserHasCapability(
      user,
      UserCapabilityName.payment_submission_review,
      this.error,
    );

    if (
      dto.rejectionReasonCode === PaymentRejectionReasonCode.OTHER &&
      !dto.rejectionReasonText?.trim()
    ) {
      this.error.unprocessableEntity([
        'برای دلیل OTHER توضیح متنی الزامی است',
      ]);
    }

    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const submission = await queryRunner.manager.findOne(
        PaymentSubmissionEntity,
        {
          where: { id: submissionId },
          lock: { mode: 'pessimistic_write' },
        },
      );
      if (!submission) {
        this.error.unprocessableEntity(['ارسال پرداخت یافت نشد']);
      }

      if (
        submission.status !== PaymentSubmissionStatus.SUBMITTED &&
        submission.status !== PaymentSubmissionStatus.UNDER_REVIEW
      ) {
        this.error.unprocessableEntity(['این ارسال قابل رد نیست']);
      }

      const now = new Date();
      const from = submission.status;
      submission.status = PaymentSubmissionStatus.REJECTED;
      submission.activeLockKey = null;
      submission.holdExpiresAt = null;
      submission.rejectionReasonCode = dto.rejectionReasonCode;
      submission.rejectionReasonText = dto.rejectionReasonText?.trim() || null;
      submission.reviewedAt = now;
      submission.reviewedByUserId = user.id;
      submission.updatedAt = now;
      await queryRunner.manager.save(submission);

      await this.appendReviewEvent(queryRunner, {
        submissionId,
        actorUserId: user.id,
        action: 'REJECT',
        fromStatus: from,
        toStatus: PaymentSubmissionStatus.REJECTED,
        reasonCode: dto.rejectionReasonCode,
        reasonText: dto.rejectionReasonText?.trim() || null,
      });

      await queryRunner.commitTransaction();
      return submission;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async streamReceiptForCustomer(
    objectKey: string,
    customerId: number,
  ): Promise<{
    object: PrivateReceiptObjectEntity;
    stream: NodeJS.ReadableStream;
  }> {
    const object = await this.receiptStorage.getByObjectKey(objectKey);
    if (!object || object.customerId !== customerId) {
      this.error.unprocessableEntity(['رسید یافت نشد']);
    }
    const stream = await this.receiptStorage.openReadStream(object.storageKey);
    return { object, stream };
  }

  async streamReceiptForAdmin(submissionId: number): Promise<{
    object: PrivateReceiptObjectEntity;
    stream: NodeJS.ReadableStream;
  }> {
    const submission = await this.submissionRepository.findOne({
      where: { id: submissionId },
    });
    if (!submission?.activeEvidenceId) {
      this.error.unprocessableEntity(['رسید یافت نشد']);
    }
    const evidence = await this.evidenceRepository.findOne({
      where: { id: submission.activeEvidenceId },
    });
    if (!evidence) {
      this.error.unprocessableEntity(['رسید یافت نشد']);
    }
    const object = await this.receiptStorage.getById(evidence.receiptObjectId);
    if (!object) {
      this.error.unprocessableEntity(['رسید یافت نشد']);
    }
    const stream = await this.receiptStorage.openReadStream(object.storageKey);
    return { object, stream };
  }

  /**
   * Own short transaction: lock submission, expire if hold past, commit.
   * Returns true when this call transitioned the row to EXPIRED.
   */
  async expireSubmissionIfNeededDurable(
    submissionId: number,
  ): Promise<boolean> {
    const now = new Date();
    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const locked = await queryRunner.manager.findOne(
        PaymentSubmissionEntity,
        {
          where: { id: submissionId },
          lock: { mode: 'pessimistic_write' },
        },
      );
      if (
        !locked ||
        !ACTIVE_MANUAL_PAYMENT_HOLD_STATUSES.includes(locked.status) ||
        !locked.holdExpiresAt ||
        locked.holdExpiresAt > now
      ) {
        await queryRunner.commitTransaction();
        return false;
      }

      const from = locked.status;
      locked.status = PaymentSubmissionStatus.EXPIRED;
      locked.activeLockKey = null;
      locked.updatedAt = now;
      await queryRunner.manager.save(locked);
      await this.appendReviewEvent(queryRunner, {
        submissionId: locked.id,
        action: 'EXPIRE',
        fromStatus: from,
        toStatus: PaymentSubmissionStatus.EXPIRED,
      });
      await queryRunner.commitTransaction();
      return true;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Mark expired holds; used by TasksService cron / cleanup.
   */
  async expireHoldsBatch(limit = 100): Promise<number> {
    const now = new Date();
    const expired = await this.submissionRepository
      .createQueryBuilder('ps')
      .where('ps.status IN (:...statuses)', {
        statuses: ACTIVE_MANUAL_PAYMENT_HOLD_STATUSES,
      })
      .andWhere('ps.holdExpiresAt IS NOT NULL')
      .andWhere('ps.holdExpiresAt <= :now', { now })
      .take(limit)
      .getMany();

    let count = 0;
    for (const row of expired) {
      const did = await this.expireSubmissionIfNeededDurable(row.id);
      if (did) {
        count += 1;
      }
    }
    return count;
  }

  private async findOwnedByIdempotency(params: {
    idempotencyKey: string;
    customerId: number;
    orderId: number;
  }): Promise<PaymentSubmissionEntity | null> {
    return this.submissionRepository.findOne({
      where: {
        idempotencyKey: params.idempotencyKey,
        customerId: params.customerId,
        orderId: params.orderId,
      },
    });
  }

  /**
   * Under Order lock: expire any SUBMITTED/UNDER_REVIEW rows whose hold is past.
   */
  private async expireExpiredHoldsForOrderUnderLock(
    queryRunner: QueryRunner,
    orderId: number,
    now: Date,
  ): Promise<void> {
    const candidates = await queryRunner.manager
      .createQueryBuilder(PaymentSubmissionEntity, 'ps')
      .setLock('pessimistic_write')
      .where('ps.orderId = :orderId', { orderId })
      .andWhere('ps.purpose = :purpose', {
        purpose: PaymentSubmissionPurpose.ORDER_PAYMENT,
      })
      .andWhere('ps.status IN (:...statuses)', {
        statuses: ACTIVE_MANUAL_PAYMENT_HOLD_STATUSES,
      })
      .andWhere('ps.holdExpiresAt IS NOT NULL')
      .andWhere('ps.holdExpiresAt <= :now', { now })
      .orderBy('ps.id', 'ASC')
      .getMany();

    for (const locked of candidates) {
      const from = locked.status;
      locked.status = PaymentSubmissionStatus.EXPIRED;
      locked.activeLockKey = null;
      locked.updatedAt = now;
      await queryRunner.manager.save(locked);
      await this.appendReviewEvent(queryRunner, {
        submissionId: locked.id,
        action: 'EXPIRE',
        fromStatus: from,
        toStatus: PaymentSubmissionStatus.EXPIRED,
      });
    }
  }

  private async findActiveHoldUnderLock(
    queryRunner: QueryRunner,
    orderId: number,
    now: Date,
  ): Promise<PaymentSubmissionEntity | null> {
    const rows = await queryRunner.manager
      .createQueryBuilder(PaymentSubmissionEntity, 'ps')
      .where('ps.orderId = :orderId', { orderId })
      .andWhere('ps.purpose = :purpose', {
        purpose: PaymentSubmissionPurpose.ORDER_PAYMENT,
      })
      .andWhere('ps.status IN (:...statuses)', {
        statuses: ACTIVE_MANUAL_PAYMENT_HOLD_STATUSES,
      })
      .andWhere('ps.holdExpiresAt > :now', { now })
      .orderBy('ps.id', 'DESC')
      .getMany();

    return rows.find((r) => hasActiveOrderPaymentHold(r, now)) || null;
  }

  private async assertOrderEligibleLocked(
    queryRunner: QueryRunner,
    order: OrderEntity,
    now: Date,
    opts: { submitDeadlineHours: number },
  ): Promise<void> {
    if (order.customerId == null) {
      this.error.unprocessableEntity(['مالکیت سفارش نامعتبر است']);
    }
    this.assertOrderEligibleForManualPayment(order);

    if (order.successfulTransactionId != null) {
      this.error.unprocessableEntity(['این سفارش پرداخت شده است']);
    }

    const finalization = await queryRunner.manager.findOne(
      OrderPaymentFinalizationEntity,
      { where: { orderId: order.id } },
    );
    if (finalization) {
      this.error.unprocessableEntity(['این سفارش پرداخت شده است']);
    }

    const submitDeadline = addHours(
      new Date(order.createdAt),
      opts.submitDeadlineHours,
    );
    if (now > submitDeadline) {
      this.error.unprocessableEntity([
        'مهلت ارسال رسید پرداخت برای این سفارش به پایان رسیده است',
      ]);
    }
  }

  private async appendReviewEvent(
    queryRunner: QueryRunner,
    event: {
      submissionId: number;
      actorUserId?: number | null;
      actorCustomerId?: number | null;
      action: string;
      fromStatus: string | null;
      toStatus: string | null;
      reasonCode?: string | null;
      reasonText?: string | null;
      metadataJson?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await queryRunner.manager
      .createQueryBuilder()
      .insert()
      .into(PaymentReviewEventEntity)
      .values({
        submissionId: event.submissionId,
        actorUserId: event.actorUserId ?? null,
        actorCustomerId: event.actorCustomerId ?? null,
        action: event.action,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        reasonCode: event.reasonCode ?? null,
        reasonText: event.reasonText ?? null,
        metadataJson: event.metadataJson ?? null,
        createdAt: new Date(),
      })
      .execute();
  }

  private async toSubmissionDetail(submission: PaymentSubmissionEntity) {
    const evidence = await this.evidenceRepository.find({
      where: { submissionId: submission.id },
      order: { attemptNo: 'ASC' },
    });
    const active = evidence.find((e) => e.id === submission.activeEvidenceId);
    let receiptObjectKey: string | null = null;
    if (active) {
      const obj = await this.receiptStorage.getById(active.receiptObjectId);
      receiptObjectKey = obj?.objectKey ?? null;
    }
    return {
      ...submission,
      evidence,
      activeEvidence: active || null,
      receiptObjectKey,
      holdActive: hasActiveOrderPaymentHold(submission),
    };
  }

  private async requireCustomerOrder(orderId: number, customerId: number) {
    const order = await this.orderRepository.findOne({
      where: { id: orderId, customerId },
    });
    if (!order) {
      this.error.unprocessableEntity(['سفارش یافت نشد']);
    }
    return order;
  }

  private assertOrderEligibleForManualPayment(order: OrderEntity): void {
    if (isOrderAlreadyPaid(order.status)) {
      this.error.unprocessableEntity(['این سفارش پرداخت شده است']);
    }
    if (!isOrderPaymentInitiatable(order.status)) {
      this.error.unprocessableEntity(['این سفارش قابل پرداخت نمی‌باشد']);
    }
  }

  private settlementFromOrderOrThrow(order: OrderEntity) {
    try {
      return computeSettlementFromOrderSnapshot(order);
    } catch (e) {
      if (e?.message === 'order_fx_snapshot_missing') {
        this.error.unprocessableEntity(
          ['نرخ ارز سفارش موجود نیست. امکان پرداخت دستی وجود ندارد.'],
          { code: 'order_fx_snapshot_missing' },
        );
      }
      throw e;
    }
  }

  private async getSettings(): Promise<SettingEntity> {
    const setting = await this.settingRepository.findOne({ where: { id: 1 } });
    if (!setting) {
      this.error.unprocessableEntity(['تنظیمات یافت نشد']);
    }
    return setting;
  }
}
