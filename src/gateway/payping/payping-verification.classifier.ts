import {
  PAYPING_ALREADY_VERIFIED_CODES,
  PAYPING_DEFINITIVE_VERIFY_REJECTION_CODES,
  PaypingVerificationError,
  PaypingVerificationErrorDetails,
  PaypingVerificationOutcome,
  isPaypingVerificationError,
} from './payping-verification-result';

export function classifyPaypingVerificationError(
  error: unknown,
): PaypingVerificationOutcome {
  if (isPaypingVerificationError(error)) {
    return classifyPaypingVerificationDetails(error.details);
  }

  if (
    error &&
    typeof error === 'object' &&
    (error as PaypingVerificationErrorDetails).kind ===
      'payping_verification_error'
  ) {
    return classifyPaypingVerificationDetails(
      error as PaypingVerificationErrorDetails,
    );
  }

  return 'uncertain';
}

export function classifyPaypingVerificationDetails(
  details: PaypingVerificationErrorDetails,
): PaypingVerificationOutcome {
  if (!details.providerResponseReceived) {
    return 'uncertain';
  }

  if (details.isTimeout || details.isNetworkError) {
    return 'uncertain';
  }

  if (details.axiosCode && !details.providerResponseReceived) {
    return 'uncertain';
  }

  const codeKey =
    details.providerErrorCode != null
      ? String(details.providerErrorCode)
      : undefined;

  if (codeKey && PAYPING_ALREADY_VERIFIED_CODES.has(codeKey)) {
    return 'already_verified';
  }

  if (codeKey && PAYPING_DEFINITIVE_VERIFY_REJECTION_CODES.has(codeKey)) {
    return 'definitive_failure';
  }

  if (details.httpStatus != null && details.httpStatus >= 500) {
    return 'uncertain';
  }

  if (details.providerResponseReceived) {
    return 'uncertain';
  }

  return 'uncertain';
}
