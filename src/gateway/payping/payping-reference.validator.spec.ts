import { validatePaypingReferenceNumber } from './payping-reference.validator';

describe('validatePaypingReferenceNumber', () => {
  it('accepts numeric references >= 100', () => {
    expect(validatePaypingReferenceNumber('123456')).toBe(true);
    expect(validatePaypingReferenceNumber('100')).toBe(true);
  });

  it('rejects values below 100', () => {
    expect(validatePaypingReferenceNumber('99')).toBe(false);
    expect(validatePaypingReferenceNumber('1')).toBe(false);
  });

  it('rejects NaN-producing values', () => {
    expect(validatePaypingReferenceNumber('abc')).toBe(false);
    expect(validatePaypingReferenceNumber('')).toBe(false);
    expect(validatePaypingReferenceNumber(null)).toBe(false);
    expect(validatePaypingReferenceNumber(undefined)).toBe(false);
  });
});
