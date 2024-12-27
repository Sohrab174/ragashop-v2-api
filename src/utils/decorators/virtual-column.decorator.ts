import 'reflect-metadata';
import { ValueTransformer } from 'typeorm';

export const VIRTUAL_COLUMN_KEY = Symbol('VIRTUAL_COLUMN_KEY');

interface ColumnOptions {
  /**
   * Specifies a value transformer that is to be used to (un)marshal
   * this column when reading or writing to the database.
   */
  transformer?: ValueTransformer | ValueTransformer[];
}

export function VirtualColumn(
  name?: string,
  options?: ColumnOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    const metaInfo = Reflect.getMetadata(VIRTUAL_COLUMN_KEY, target) || {};

    metaInfo[propertyKey] = { name: name ?? propertyKey, options };

    Reflect.defineMetadata(VIRTUAL_COLUMN_KEY, metaInfo, target);
  };
}
