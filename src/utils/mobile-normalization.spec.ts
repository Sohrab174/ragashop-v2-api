import {
  normalizeCustomerMobile,
  isNormalizedCustomerMobile,
} from './mobile-normalization';

describe('normalizeCustomerMobile', () => {
  it('normalizes Iranian local format', () => {
    expect(normalizeCustomerMobile('09123456789')).toBe('+989123456789');
  });

  it('normalizes Persian digits', () => {
    expect(normalizeCustomerMobile('۰۹۱۲۳۴۵۶۷۸۹')).toBe('+989123456789');
  });

  it('preserves international format', () => {
    expect(normalizeCustomerMobile('+905551112233')).toBe('+905551112233');
  });

  it('strips internal whitespace and hyphens', () => {
    expect(normalizeCustomerMobile('0912-345 6789')).toBe('+989123456789');
  });

  it('normalizes 989 prefix', () => {
    expect(normalizeCustomerMobile('989123456789')).toBe('+989123456789');
  });

  it('normalizes 00989 prefix', () => {
    expect(normalizeCustomerMobile('00989123456789')).toBe('+989123456789');
  });

  it('returns empty for null/empty', () => {
    expect(normalizeCustomerMobile('')).toBe('');
    expect(normalizeCustomerMobile(null)).toBe('');
  });

  it('rejects malformed values via isNormalizedCustomerMobile', () => {
    expect(isNormalizedCustomerMobile('')).toBe(false);
    expect(isNormalizedCustomerMobile('++98912')).toBe(false);
    expect(isNormalizedCustomerMobile('+989123456789')).toBe(true);
  });
});
