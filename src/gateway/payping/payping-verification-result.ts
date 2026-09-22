/**
 * Structured PayPing verification/transport result.
 * Classification MUST use these fields — never localized message text.
 */
export type PaypingVerificationOutcome =
  | 'success'
  | 'definitive_failure'
  | 'uncertain'
  | 'already_verified';

export interface PaypingVerificationErrorDetails {
  kind: 'payping_verification_error';
  providerResponseReceived: boolean;
  httpStatus?: number;
  providerErrorCode?: string | number;
  axiosCode?: string;
  isTimeout: boolean;
  isNetworkError: boolean;
  providerReference?: string;
  responseBodySnippet?: string;
  /** Human-readable detail for logs/storage only — NOT for classification */
  message: string;
}

export class PaypingVerificationError extends Error {
  readonly details: PaypingVerificationErrorDetails;

  constructor(details: PaypingVerificationErrorDetails) {
    super(details.message);
    this.name = 'PaypingVerificationError';
    this.details = details;
  }
}

export interface PaypingPaymentRequestErrorDetails {
  kind: 'payping_payment_request_error';
  providerResponseReceived: boolean;
  httpStatus?: number;
  providerErrorCode?: string | number;
  axiosCode?: string;
  isTimeout: boolean;
  isNetworkError: boolean;
  responseBodySnippet?: string;
  message: string;
}

export class PaypingPaymentRequestError extends Error {
  readonly details: PaypingPaymentRequestErrorDetails;

  constructor(details: PaypingPaymentRequestErrorDetails) {
    super(details.message);
    this.name = 'PaypingPaymentRequestError';
    this.details = details;
  }
}

const TRANSPORT_AXIOS_CODES = new Set([
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ERR_NETWORK',
  'EAI_AGAIN',
]);

/**
 * Documented PayPing verify rejection codes only.
 * Empty by default — unknown provider responses remain uncertain.
 */
export const PAYPING_DEFINITIVE_VERIFY_REJECTION_CODES = new Set<string>([
  // Populate only when confirmed against provider contract.
]);

/**
 * Documented PayPing already-settled / duplicate-verify codes only.
 */
export const PAYPING_ALREADY_VERIFIED_CODES = new Set<string>([
  // Populate only when confirmed against provider contract.
]);

export function isPaypingVerificationError(
  error: unknown,
): error is PaypingVerificationError {
  return error instanceof PaypingVerificationError;
}

export function isPaypingPaymentRequestError(
  error: unknown,
): error is PaypingPaymentRequestError {
  return error instanceof PaypingPaymentRequestError;
}

export function buildPaypingVerificationErrorFromAxios(
  error: any,
  providerReference?: string,
): PaypingVerificationError {
  const providerResponseReceived = !!error?.response;
  const httpStatus = error?.response?.status;
  const axiosCode = error?.code as string | undefined;
  const isTimeout = axiosCode === 'ECONNABORTED' || axiosCode === 'ETIMEDOUT';
  const isNetworkError =
    !providerResponseReceived &&
    !!axiosCode &&
    TRANSPORT_AXIOS_CODES.has(axiosCode);

  const body = error?.response?.data;
  const providerErrorCode =
    body?.Code ?? body?.code ?? body?.ErrorCode ?? body?.errorCode;
  const providerMessage =
    typeof body?.Error === 'string'
      ? body.Error
      : typeof body?.message === 'string'
      ? body.message
      : typeof error?.message === 'string'
      ? error.message
      : 'PayPing verification error';

  let responseBodySnippet: string | undefined;
  try {
    if (body != null) {
      responseBodySnippet = JSON.stringify(body).slice(0, 512);
    }
  } catch {
    responseBodySnippet = undefined;
  }

  return new PaypingVerificationError({
    kind: 'payping_verification_error',
    providerResponseReceived,
    httpStatus,
    providerErrorCode,
    axiosCode,
    isTimeout,
    isNetworkError,
    providerReference,
    responseBodySnippet,
    message: providerMessage,
  });
}

export function buildPaypingPaymentRequestErrorFromAxios(
  error: any,
): PaypingPaymentRequestError {
  const providerResponseReceived = !!error?.response;
  const httpStatus = error?.response?.status;
  const axiosCode = error?.code as string | undefined;
  const isTimeout = axiosCode === 'ECONNABORTED' || axiosCode === 'ETIMEDOUT';
  const isNetworkError =
    !providerResponseReceived &&
    !!axiosCode &&
    TRANSPORT_AXIOS_CODES.has(axiosCode);

  const body = error?.response?.data;
  const providerErrorCode =
    body?.Code ?? body?.code ?? body?.ErrorCode ?? body?.errorCode;
  const providerMessage =
    typeof body?.Error === 'string'
      ? body.Error
      : typeof body?.message === 'string'
      ? body.message
      : typeof error === 'string'
      ? error
      : typeof error?.message === 'string'
      ? error.message
      : 'PayPing payment request error';

  let responseBodySnippet: string | undefined;
  try {
    if (body != null) {
      responseBodySnippet = JSON.stringify(body).slice(0, 512);
    }
  } catch {
    responseBodySnippet = undefined;
  }

  return new PaypingPaymentRequestError({
    kind: 'payping_payment_request_error',
    providerResponseReceived,
    httpStatus,
    providerErrorCode,
    axiosCode,
    isTimeout,
    isNetworkError,
    responseBodySnippet,
    message: providerMessage,
  });
}
