import {
  isValidIranCardNumber,
  isValidIranSheba,
  normalizeCardNumber,
  normalizeIban,
} from './iran-bank-identifiers';

describe('iran-bank-identifiers', () => {
  describe('card', () => {
    it('normalizes and validates Luhn 16-digit cards', () => {
      expect(normalizeCardNumber('6219-8610-3452-9007')).toBe(
        '6219861034529007',
      );
      expect(isValidIranCardNumber('6219861034529007')).toBe(true);
      expect(isValidIranCardNumber('6037990000000006')).toBe(true);
    });

    it('rejects short / bad checksum / non-digit garbage', () => {
      expect(isValidIranCardNumber('1234')).toBe(false);
      expect(isValidIranCardNumber('6219861034529008')).toBe(false);
      expect(isValidIranCardNumber(null)).toBe(false);
    });
  });

  describe('sheba', () => {
    const valid = 'IR850123456789012345678901';

    it('normalizes spacing and validates MOD-97', () => {
      expect(normalizeIban('ir85 0123 4567 8901 2345 6789 01')).toBe(valid);
      expect(isValidIranSheba(valid)).toBe(true);
    });

    it('rejects wrong length or checksum', () => {
      expect(isValidIranSheba('IR00')).toBe(false);
      expect(isValidIranSheba('IR000123456789012345678901')).toBe(false);
      expect(isValidIranSheba(null)).toBe(false);
    });
  });
});
