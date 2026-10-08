export enum ManualPaymentRail {
  CARD_TO_CARD = 'CARD_TO_CARD',
  PAYA = 'PAYA',
  POL = 'POL',
  SATNA = 'SATNA',
}

export enum PaymentSubmissionPurpose {
  ORDER_PAYMENT = 'ORDER_PAYMENT',
}

export enum PaymentSubmissionStatus {
  SUBMITTED = 'SUBMITTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

/** Statuses that hold inventory / block unpaid cleanup. */
export const ACTIVE_MANUAL_PAYMENT_HOLD_STATUSES: PaymentSubmissionStatus[] = [
  PaymentSubmissionStatus.SUBMITTED,
  PaymentSubmissionStatus.UNDER_REVIEW,
];

export enum PaymentRejectionReasonCode {
  UNREADABLE = 'UNREADABLE',
  WRONG_AMOUNT = 'WRONG_AMOUNT',
  WRONG_DESTINATION = 'WRONG_DESTINATION',
  INVALID_REFERENCE = 'INVALID_REFERENCE',
  PAYMENT_NOT_FOUND = 'PAYMENT_NOT_FOUND',
  PAYER_MISMATCH = 'PAYER_MISMATCH',
  DUPLICATE = 'DUPLICATE',
  OTHER = 'OTHER',
}

/** Re-export canonical catalog (ADMIN-RBAC-1). Prefer importing from capability.catalog. */
export {
  UserCapabilityName,
  ALL_USER_CAPABILITIES,
  isKnownCapability,
  capabilitySatisfiers,
} from '../auth/capability/capability.catalog';

export const RECEIPT_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Persisted timing hours must stay within these bounds.
 * Invalid/out-of-range persisted values fall back to DEFAULT via resolveTimingHours.
 */
export const MANUAL_PAYMENT_TIMING_BOUNDS = {
  submitDeadlineHours: { min: 1, max: 168 }, // 1h–7d
  reviewHoldHours: { min: 1, max: 168 },
  resubmitGraceHours: { min: 1, max: 72 },
} as const;

export type ManualPaymentTimingKind = keyof typeof MANUAL_PAYMENT_TIMING_BOUNDS;

export const MANUAL_PAYMENT_TIMING_DEFAULTS: Record<
  ManualPaymentTimingKind,
  number
> = {
  submitDeadlineHours: 24,
  reviewHoldHours: 48,
  resubmitGraceHours: 24,
};

/**
 * Fail-safe resolver: invalid / negative / huge persisted values → DEFAULT.
 * NEVER returns out-of-bounds numbers from raw settings.
 */
export function resolveTimingHours(
  raw: unknown,
  kind: ManualPaymentTimingKind,
): number {
  const bounds = MANUAL_PAYMENT_TIMING_BOUNDS[kind];
  const fallback = MANUAL_PAYMENT_TIMING_DEFAULTS[kind];
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return fallback;
  }
  if (n < bounds.min || n > bounds.max) {
    return fallback;
  }
  return n;
}
