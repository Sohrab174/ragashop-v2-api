import { ValueTransformer } from 'typeorm';

/**
 * Money-scale decimal ↔ string for TypeORM.
 *
 * TypeORM applies transformers before the undefined→DEFAULT branch on insert.
 * Returning "NaN" for missing optional decimals previously broke nullable columns
 * (e.g. transaction.paymentFeeAmount on manual receipt approval).
 *
 * Missing / non-finite values persist as SQL NULL. Zero stays "0.00".
 */
export class DecimalTransformer implements ValueTransformer {
  to(value: number | string | null | undefined): string | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) {
      return null;
    }
    return Number.parseFloat(n.toString()).toFixed(2);
  }

  from(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const n =
      typeof value === 'number' ? value : Number.parseFloat(String(value));
    return Number.isFinite(n) ? n : null;
  }
}
