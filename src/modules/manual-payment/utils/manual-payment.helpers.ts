import {
  ACTIVE_MANUAL_PAYMENT_HOLD_STATUSES,
  PaymentSubmissionStatus,
} from '../manual-payment.types';

export type ManualPaymentHoldSnapshot = {
  status: PaymentSubmissionStatus | string;
  holdExpiresAt: Date | string | null;
};

/**
 * True when an ORDER_PAYMENT submission is actively holding unpaid inventory.
 */
export function hasActiveOrderPaymentHold(
  submission: ManualPaymentHoldSnapshot | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!submission) {
    return false;
  }
  if (
    !ACTIVE_MANUAL_PAYMENT_HOLD_STATUSES.includes(
      submission.status as PaymentSubmissionStatus,
    )
  ) {
    return false;
  }
  if (submission.holdExpiresAt == null) {
    return false;
  }
  const expires = new Date(submission.holdExpiresAt);
  if (Number.isNaN(expires.getTime())) {
    return false;
  }
  return expires.getTime() > now.getTime();
}

export function normalizeBankReference(
  value: string | null | undefined,
): string | null {
  if (value == null) {
    return null;
  }
  const normalized = String(value)
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.]/g, '');
  return normalized.length > 0 ? normalized : null;
}

export function amountsMatch(
  submitted: number | null | undefined,
  expected: number,
): boolean {
  if (submitted == null || !Number.isFinite(Number(submitted))) {
    return true; // missing submitted amount is not treated as mismatch
  }
  return Math.round(Number(submitted)) === Math.round(Number(expected));
}

export function buildActiveLockKey(orderId: number): string {
  return `ORDER_PAYMENT:${orderId}`;
}

export function addHours(from: Date, hours: number): Date {
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}
