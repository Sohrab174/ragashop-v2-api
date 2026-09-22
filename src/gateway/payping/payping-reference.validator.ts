/**
 * PayPing refId validation aligned with current integration expectations.
 * refId must be a numeric provider reference (digits only), minimum 100.
 */
export function validatePaypingReferenceNumber(
  referenceNumber: unknown,
): referenceNumber is string {
  if (referenceNumber === null || referenceNumber === undefined) {
    return false;
  }

  if (
    typeof referenceNumber !== 'string' &&
    typeof referenceNumber !== 'number'
  ) {
    return false;
  }

  const raw =
    typeof referenceNumber === 'number'
      ? String(referenceNumber)
      : referenceNumber.trim();

  if (!raw || !/^[0-9]+$/.test(raw)) {
    return false;
  }

  const num = Number(raw);
  return Number.isFinite(num) && Number.isSafeInteger(num) && num >= 100;
}
