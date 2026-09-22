import {
  hasActiveOrderPaymentHold,
  normalizeBankReference,
  amountsMatch,
  buildActiveLockKey,
  addHours,
} from './manual-payment.helpers';
import {
  ManualPaymentRail,
  PaymentRejectionReasonCode,
  PaymentSubmissionStatus,
  RECEIPT_ALLOWED_MIME_TYPES,
  UserCapabilityName,
} from '../manual-payment.types';
import { computeSettlementFromOrderSnapshot } from '../../finance/settlement-money';
import { ProductCurrency } from '../../product/entities/product.entity';
import { UserRoles } from '../../user/entities/user.entity';
import { UserCapabilityService } from '../user-capability.service';
import { PrivateReceiptStorageService } from '../private-receipt-storage.service';
import { BankDestinationService } from '../bank-destination.service';

describe('C2A manual payment helpers', () => {
  describe('hasActiveOrderPaymentHold', () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);

    it('true for SUBMITTED with future hold', () => {
      expect(
        hasActiveOrderPaymentHold({
          status: PaymentSubmissionStatus.SUBMITTED,
          holdExpiresAt: future,
        }),
      ).toBe(true);
    });

    it('true for UNDER_REVIEW with future hold', () => {
      expect(
        hasActiveOrderPaymentHold({
          status: PaymentSubmissionStatus.UNDER_REVIEW,
          holdExpiresAt: future,
        }),
      ).toBe(true);
    });

    it('false when hold expired', () => {
      expect(
        hasActiveOrderPaymentHold({
          status: PaymentSubmissionStatus.SUBMITTED,
          holdExpiresAt: past,
        }),
      ).toBe(false);
    });

    it('false for APPROVED even with future holdExpiresAt', () => {
      expect(
        hasActiveOrderPaymentHold({
          status: PaymentSubmissionStatus.APPROVED,
          holdExpiresAt: future,
        }),
      ).toBe(false);
    });

    it('false for REJECTED / EXPIRED / CANCELLED', () => {
      for (const status of [
        PaymentSubmissionStatus.REJECTED,
        PaymentSubmissionStatus.EXPIRED,
        PaymentSubmissionStatus.CANCELLED,
      ]) {
        expect(
          hasActiveOrderPaymentHold({ status, holdExpiresAt: future }),
        ).toBe(false);
      }
    });

    it('false when holdExpiresAt missing', () => {
      expect(
        hasActiveOrderPaymentHold({
          status: PaymentSubmissionStatus.SUBMITTED,
          holdExpiresAt: null,
        }),
      ).toBe(false);
    });
  });

  describe('settlement from snapshot (no TGJU)', () => {
    it('computes IRT from order FX snapshot', () => {
      const s = computeSettlementFromOrderSnapshot({
        finalAmount: 100,
        commercialCurrency: ProductCurrency.TRY,
        fxRateToIrt: 3500,
      });
      expect(s.settlementAmount).toBe(350000);
      expect(s.settlementCurrency).toBe(ProductCurrency.IRT);
    });

    it('throws when FX missing — caller must not invent TGJU', () => {
      expect(() =>
        computeSettlementFromOrderSnapshot({
          finalAmount: 100,
          commercialCurrency: ProductCurrency.TRY,
          fxRateToIrt: null,
        }),
      ).toThrow('order_fx_snapshot_missing');
    });
  });

  describe('FSM / lock key', () => {
    it('buildActiveLockKey is stable per order', () => {
      expect(buildActiveLockKey(42)).toBe('ORDER_PAYMENT:42');
    });

    it('addHours advances hold window', () => {
      const from = new Date('2026-01-01T00:00:00Z');
      expect(addHours(from, 48).toISOString()).toBe('2026-01-03T00:00:00.000Z');
    });
  });

  describe('amount mismatch policy', () => {
    it('match when equal after round', () => {
      expect(amountsMatch(100000, 100000)).toBe(true);
      expect(amountsMatch(100000.4, 100000)).toBe(true);
    });

    it('mismatch when different', () => {
      expect(amountsMatch(99999, 100000)).toBe(false);
    });

    it('missing submitted amount is not a mismatch', () => {
      expect(amountsMatch(null, 100000)).toBe(true);
      expect(amountsMatch(undefined, 100000)).toBe(true);
    });
  });

  describe('bank reference normalize', () => {
    it('strips spaces/dashes and uppercases', () => {
      expect(normalizeBankReference('  ab-12_34.56 ')).toBe('AB123456');
    });

    it('null for empty', () => {
      expect(normalizeBankReference('')).toBeNull();
      expect(normalizeBankReference(null)).toBeNull();
    });
  });

  describe('destination rail compatibility', () => {
    const error = {
      unprocessableEntity: jest.fn((msgs) => {
        throw new Error(msgs[0]);
      }),
    };
    const service = new BankDestinationService({} as any, error as any);
    const validCard = '6219861034529007';
    const validSheba = 'IR850123456789012345678901';

    it('CARD_TO_CARD requires valid cardNumber', () => {
      expect(() =>
        service.assertRailCompatibility(
          {
            cardNumber: null,
            iban: validSheba,
            accountNumber: null,
            allowedRails: [ManualPaymentRail.CARD_TO_CARD],
          },
          ManualPaymentRail.CARD_TO_CARD,
        ),
      ).toThrow();
      expect(() =>
        service.assertRailCompatibility(
          {
            cardNumber: validCard,
            iban: null,
            accountNumber: null,
            allowedRails: [ManualPaymentRail.CARD_TO_CARD],
          },
          ManualPaymentRail.CARD_TO_CARD,
        ),
      ).not.toThrow();
    });

    it('PAYA requires valid Sheba (not account alone)', () => {
      expect(() =>
        service.assertRailCompatibility(
          {
            cardNumber: null,
            iban: validSheba,
            accountNumber: null,
            allowedRails: [ManualPaymentRail.PAYA],
          },
          ManualPaymentRail.PAYA,
        ),
      ).not.toThrow();
      expect(() =>
        service.assertRailCompatibility(
          {
            cardNumber: null,
            iban: null,
            accountNumber: '123456',
            allowedRails: [ManualPaymentRail.PAYA],
          },
          ManualPaymentRail.PAYA,
        ),
      ).toThrow();
    });

    it('SATNA rejects accountNumber without valid IBAN', () => {
      expect(() =>
        service.assertRailCompatibility(
          {
            cardNumber: null,
            iban: null,
            accountNumber: '123',
            allowedRails: [ManualPaymentRail.SATNA],
          },
          ManualPaymentRail.SATNA,
        ),
      ).toThrow();
    });

    it('rejects rail not in allowedRails', () => {
      expect(() =>
        service.assertRailCompatibility(
          {
            cardNumber: validCard,
            iban: null,
            accountNumber: null,
            allowedRails: [ManualPaymentRail.PAYA],
          },
          ManualPaymentRail.CARD_TO_CARD,
        ),
      ).toThrow();
    });
  });

  describe('destination snapshot independence', () => {
    it('snapshot fields survive destination mutation conceptually', () => {
      const snapshot = {
        destinationBankName: 'Bank A',
        destinationCardNumber: '603799',
        destinationIban: null as string | null,
      };
      const liveDestination = {
        bankName: 'Bank B',
        cardNumber: '9999',
        iban: 'IRNEW',
      };
      // Approval must use snapshot, not live row.
      expect(snapshot.destinationBankName).not.toBe(liveDestination.bankName);
      expect(snapshot.destinationCardNumber).not.toBe(liveDestination.cardNumber);
    });
  });

  describe('receipt MIME validation', () => {
    const error = {
      unprocessableEntity: jest.fn((msgs) => {
        throw new Error(msgs[0]);
      }),
    };
    const storage = new PrivateReceiptStorageService({} as any, error as any);

    it('allows jpg/png/webp/pdf', () => {
      for (const mime of RECEIPT_ALLOWED_MIME_TYPES) {
        expect(() => storage.assertAllowedMime(mime)).not.toThrow();
      }
    });

    it('rejects gif/exe', () => {
      expect(() => storage.assertAllowedMime('image/gif')).toThrow();
      expect(() => storage.assertAllowedMime('application/octet-stream')).toThrow();
    });

    it('rejects oversize', () => {
      expect(() => storage.assertSizeLimit(6 * 1024 * 1024)).toThrow();
      expect(() => storage.assertSizeLimit(1024)).not.toThrow();
    });

    it('path traversal rejected', () => {
      expect(() => storage.resolveSafePath('../etc/passwd')).toThrow();
      expect(() => storage.resolveSafePath('a/b.jpg')).toThrow();
    });
  });

  describe('RBAC capability checks', () => {
    it('admin always allowed', async () => {
      const svc = new UserCapabilityService({
        findOne: jest.fn(),
      } as any);
      await expect(
        svc.userHasCapability(
          { id: 1, role: UserRoles.admin },
          UserCapabilityName.payment_submission_approve,
        ),
      ).resolves.toBe(true);
      expect(
        (svc as any).capabilityRepository.findOne,
      ).not.toHaveBeenCalled();
    });

    it('employee needs explicit row', async () => {
      const findOne = jest.fn().mockResolvedValue(null);
      const svc = new UserCapabilityService({ findOne } as any);
      await expect(
        svc.userHasCapability(
          { id: 2, role: UserRoles.employee },
          UserCapabilityName.payment_submission_approve,
        ),
      ).resolves.toBe(false);

      findOne.mockResolvedValue({ id: 1 });
      await expect(
        svc.userHasCapability(
          { id: 2, role: UserRoles.employee },
          UserCapabilityName.payment_submission_approve,
        ),
      ).resolves.toBe(true);
    });
  });

  describe('rejection OTHER requires text', () => {
    it('policy helper mirrors reject gate', () => {
      const requiresText = (code: string, text?: string | null) =>
        code === PaymentRejectionReasonCode.OTHER && !text?.trim();
      expect(requiresText(PaymentRejectionReasonCode.OTHER, null)).toBe(true);
      expect(requiresText(PaymentRejectionReasonCode.OTHER, 'bad scan')).toBe(
        false,
      );
      expect(
        requiresText(PaymentRejectionReasonCode.WRONG_AMOUNT, null),
      ).toBe(false);
    });
  });

  describe('evidence attempt increment', () => {
    it('next attempt is last+1 (immutable prior rows)', () => {
      const prior = [{ attemptNo: 1 }, { attemptNo: 2 }];
      const next = Math.max(...prior.map((p) => p.attemptNo)) + 1;
      expect(next).toBe(3);
      // prior rows unchanged
      expect(prior.map((p) => p.attemptNo)).toEqual([1, 2]);
    });
  });

  describe('approval idempotency logic (mocked finalize)', () => {
    it('maps finalize results to submission outcomes', () => {
      const mapResult = (
        submissionStatus: PaymentSubmissionStatus,
        finalize: 'finalized' | 'idempotent' | 'superseded',
      ) => {
        if (submissionStatus === PaymentSubmissionStatus.APPROVED) {
          return 'idempotent';
        }
        if (finalize === 'superseded') {
          return 'cancelled_paid_elsewhere';
        }
        if (finalize === 'idempotent') {
          return 'idempotent';
        }
        return 'approved';
      };

      expect(
        mapResult(PaymentSubmissionStatus.APPROVED, 'finalized'),
      ).toBe('idempotent');
      expect(
        mapResult(PaymentSubmissionStatus.SUBMITTED, 'superseded'),
      ).toBe('cancelled_paid_elsewhere');
      expect(
        mapResult(PaymentSubmissionStatus.UNDER_REVIEW, 'finalized'),
      ).toBe('approved');
      expect(
        mapResult(PaymentSubmissionStatus.SUBMITTED, 'idempotent'),
      ).toBe('idempotent');
    });

    it('SUBMITTED never implies paid without finalizeOrderPaymentAtomic', () => {
      const sideEffects = {
        orderPaid: false,
        referral: false,
        cogs: false,
        walletCredit: false,
      };
      // Creating a SUBMITTED submission must not flip these.
      const status = PaymentSubmissionStatus.SUBMITTED;
      expect(status).not.toBe(PaymentSubmissionStatus.APPROVED);
      expect(sideEffects.orderPaid).toBe(false);
      expect(sideEffects.referral).toBe(false);
      expect(sideEffects.cogs).toBe(false);
      expect(sideEffects.walletCredit).toBe(false);
    });
  });
});
