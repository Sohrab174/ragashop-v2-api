import { DecimalTransformer } from './DecimalTransformer';

/**
 * Mirrors TypeORM MysqlDriver.preparePersistentValue: transformer runs
 * before the undefined → DEFAULT / NULL branch.
 */
function preparePersistentDecimal(value: unknown): string | null | undefined {
  const transformed = new DecimalTransformer().to(value as any);
  if (transformed === null || transformed === undefined) {
    return transformed;
  }
  return transformed;
}

describe('DecimalTransformer', () => {
  const transformer = new DecimalTransformer();

  describe('to (persist)', () => {
    it('maps null, undefined and empty string to SQL null', () => {
      expect(transformer.to(null)).toBeNull();
      expect(transformer.to(undefined as any)).toBeNull();
      expect(transformer.to('' as any)).toBeNull();
    });

    it('maps NaN and Infinity to SQL null (never the string NaN)', () => {
      expect(transformer.to(Number.NaN)).toBeNull();
      expect(transformer.to(Number.POSITIVE_INFINITY)).toBeNull();
      expect(transformer.to(Number.NEGATIVE_INFINITY)).toBeNull();
      expect(transformer.to('not-a-number' as any)).toBeNull();
    });

    it('preserves zero and valid money decimals at scale 2', () => {
      expect(transformer.to(0)).toBe('0.00');
      expect(transformer.to(-0)).toBe('0.00');
      expect(transformer.to(4751)).toBe('4751.00');
      expect(transformer.to(0.72)).toBe('0.72');
      expect(transformer.to(12.345)).toBe('12.35');
      expect(transformer.to('3.1' as any)).toBe('3.10');
    });
  });

  describe('from (hydrate)', () => {
    it('maps null-ish and non-finite DB values to null', () => {
      expect(transformer.from(null)).toBeNull();
      expect(transformer.from(undefined as any)).toBeNull();
      expect(transformer.from('')).toBeNull();
      expect(transformer.from('NaN')).toBeNull();
    });

    it('parses zero and valid decimals', () => {
      expect(transformer.from('0.00')).toBe(0);
      expect(transformer.from(0)).toBe(0);
      expect(transformer.from('4751.00')).toBe(4751);
      expect(transformer.from('0.72')).toBe(0.72);
    });
  });

  describe('TypeORM insert path for optional fee columns', () => {
    it('omitted paymentFeeAmount becomes null, not NaN', () => {
      const omitted: number | undefined = undefined;
      const prepared = preparePersistentDecimal(omitted);
      expect(prepared).toBeNull();
      expect(prepared).not.toBe('NaN');
    });

    it('explicit null fee stays null; zero fee stays 0.00', () => {
      expect(preparePersistentDecimal(null)).toBeNull();
      expect(preparePersistentDecimal(0)).toBe('0.00');
    });
  });
});
