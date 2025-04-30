import { ValueTransformer } from 'typeorm';

export class JsonTransformer implements ValueTransformer {
  // To db from typeorm
  to(value: any): string {
    if (value === null) {
      return null;
    }
    return JSON.stringify(value);
  }
  // From db to typeorm
  from(value: string): any {
    if (value === null) {
      return null;
    }
    return JSON.parse(value);
  }
}
