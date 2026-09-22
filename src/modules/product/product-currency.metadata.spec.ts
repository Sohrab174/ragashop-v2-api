import { getMetadataArgsStorage } from 'typeorm';
import { ProductAttributeValueEntity } from './entities/product-attribute-value.entity';
import { ProductEntity } from './entities/product.entity';
import { ProductCurrency } from './product-currency';

/**
 * Regression: loading ProductEntity before PAV used to leave
 * ProductAttributeValueEntity.costCurrency.enum === undefined because
 * ProductCurrency was declared in product.entity after the PAV import.
 */
describe('ProductAttributeValueEntity costCurrency TypeORM metadata', () => {
  it('keeps a defined ProductCurrency enum on PAV costCurrency after ProductEntity load', () => {
    // Touch ProductEntity first to recreate the historical load order.
    expect(ProductEntity).toBeDefined();
    expect(ProductAttributeValueEntity).toBeDefined();
    expect(ProductCurrency).toEqual({
      USD: 'USD',
      TRY: 'TRY',
      IRT: 'IRT',
    });

    const column = getMetadataArgsStorage().columns.find(
      (c) =>
        c.target === ProductAttributeValueEntity &&
        c.propertyName === 'costCurrency',
    );

    expect(column).toBeDefined();
    expect(column.options.enum).toBe(ProductCurrency);
    expect(column.options.enum).toBeDefined();
    expect(Object.keys(column.options.enum as object).sort()).toEqual([
      'IRT',
      'TRY',
      'USD',
    ]);
  });

  it('keeps ProductEntity costCurrency/currency enums defined', () => {
    const cols = getMetadataArgsStorage().columns.filter(
      (c) =>
        c.target === ProductEntity &&
        (c.propertyName === 'costCurrency' || c.propertyName === 'currency'),
    );
    expect(cols.length).toBe(2);
    for (const col of cols) {
      expect(col.options.enum).toBe(ProductCurrency);
    }
  });
});
