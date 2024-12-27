import { ValueTransformer } from 'typeorm';

export class BooleanTransformer implements ValueTransformer {
  // To db from typeorm
  to(value: boolean): number {
    if (value) {
      return 1;
    }
    return 0;
  }
  // From db to typeorm
  from(value: string | number): boolean {
    if (value == 1) {
      return true;
    }
    return false;
  }
}
