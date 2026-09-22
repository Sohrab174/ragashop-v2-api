import { toCustomerSafeImportError } from './marketplace-import-customer-errors';

describe('customer-safe marketplace import errors', () => {
  it.each([
    ['INVALID_URL', 'INVALID_URL'],
    ['UNSUPPORTED_PROTOCOL', 'INVALID_URL'],
    ['PRIVATE_DESTINATION', 'INVALID_URL'],
    ['UNSUPPORTED_MARKETPLACE', 'UNSUPPORTED_SOURCE'],
    ['UNSUPPORTED_PRODUCT_URL', 'UNSUPPORTED_SOURCE'],
    ['SOURCE_UNAVAILABLE', 'PRODUCT_NOT_FOUND'],
    ['CRAWLER_UNAVAILABLE', 'SOURCE_TEMPORARILY_UNAVAILABLE'],
    ['CLAIM_EXPIRED', 'SOURCE_TEMPORARILY_UNAVAILABLE'],
    ['CRAWLER_HTTP_503', 'SOURCE_TEMPORARILY_UNAVAILABLE'],
    ['INVALID_PRODUCT_DATA', 'INVALID_PRODUCT_DATA'],
    ['CRAWLER_AUTH_FAILED', 'IMPORT_FAILED'],
    ['INVALID_CRAWLER_RESPONSE', 'IMPORT_FAILED'],
    ['UNKNOWN', 'SOURCE_TEMPORARILY_UNAVAILABLE'],
  ])('maps %s → %s', (internal, expected) => {
    const result = toCustomerSafeImportError(internal, 'econnrefused secret');
    expect(result.code).toBe(expected);
    expect(result.message.toLowerCase()).not.toContain('econnrefused');
    expect(result.message.toLowerCase()).not.toContain('secret');
  });

  it('keeps customer-safe Persian validation messages', () => {
    const result = toCustomerSafeImportError(
      'UNSUPPORTED_PROTOCOL',
      'فقط لینک‌های امن (HTTPS) پشتیبانی می‌شوند.',
    );
    expect(result.code).toBe('INVALID_URL');
    expect(result.message).toContain('HTTPS');
  });
});
