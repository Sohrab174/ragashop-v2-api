import { ErrorService } from '../../../error/error.service';

const MAX_SAFE_ID = Number.MAX_SAFE_INTEGER;

export function parseStrictPositiveInt(
  value: unknown,
  error: ErrorService,
  message = 'مقدار نامعتبر است',
): number {
  if (value === null || value === undefined || value === '') {
    error.unprocessableEntity([message]);
  }

  if (
    typeof value === 'boolean' ||
    Array.isArray(value) ||
    (typeof value === 'object' && value !== null)
  ) {
    error.unprocessableEntity([message]);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      error.unprocessableEntity([message]);
    }
    if (value < 1 || value > MAX_SAFE_ID) {
      error.unprocessableEntity([message]);
    }
    return value;
  }

  if (typeof value !== 'string') {
    error.unprocessableEntity([message]);
  }

  const raw = (value as string).trim();
  if (!raw || !/^[0-9]+$/.test(raw)) {
    error.unprocessableEntity([message]);
  }

  const num = Number(raw);
  if (!Number.isSafeInteger(num) || num < 1) {
    error.unprocessableEntity([message]);
  }

  return num;
}

export function validateOrderItemQuantity(
  quantity: unknown,
  error: ErrorService,
): number {
  return parseStrictPositiveInt(quantity, error, 'تعداد محصول نامعتبر است');
}

export function validateOptionalPositiveIntId(
  value: unknown,
  error: ErrorService,
  message = 'شناسه نامعتبر است',
): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return parseStrictPositiveInt(value, error, message);
}

export function validateAdminMoney(
  value: unknown,
  error: ErrorService,
  message = 'مبلغ نامعتبر است',
): number {
  if (value === null || value === undefined) {
    error.unprocessableEntity([message]);
  }

  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) {
    error.unprocessableEntity([message]);
  }

  return num;
}

export function validateEffectiveSalePrice(
  unitPrice: number,
  discountedPrice: number | null | undefined,
  error: ErrorService,
): void {
  const effective = discountedPrice ?? unitPrice;
  if (!Number.isFinite(effective) || effective <= 0) {
    error.unprocessableEntity(['قیمت محصول نامعتبر است']);
  }
}
