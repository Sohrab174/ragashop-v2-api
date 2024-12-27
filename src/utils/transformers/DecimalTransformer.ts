import { ValueTransformer } from 'typeorm';

export class DecimalTransformer implements ValueTransformer {
  // To db from typeorm
  to(value: number): string {
    if (value === null) {
      return null;
    }
    return Number.parseFloat(Number(value).toString()).toFixed(2);
  }
  // From db to typeorm
  from(value: string): number {
    if (value === null) {
      return null;
    }
    return Number.parseFloat(value);
  }
}
