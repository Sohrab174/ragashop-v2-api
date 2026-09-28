import { ValueTransformer } from 'typeorm';

/**
 * Geographic coordinates need more than money-scale decimals.
 * Avoid DecimalTransformer's toFixed(2) which would destroy map precision.
 */
export class GeoCoordinateTransformer implements ValueTransformer {
  to(value: number | null): string | null {
    if (value == null || Number.isNaN(Number(value))) return null;
    return Number(value).toFixed(7);
  }

  from(value: string | number | null): number | null {
    if (value == null || value === '') return null;
    const n = typeof value === 'number' ? value : Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
}
