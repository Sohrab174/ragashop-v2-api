import { isCustomerVisibleProduct } from './product-visibility.util';
import { ProductStatus } from './entities/product.entity';

describe('isCustomerVisibleProduct', () => {
  it('rejects deleted active stub combinations', () => {
    expect(
      isCustomerVisibleProduct({
        isDeleted: true,
        status: ProductStatus.active,
        categoryId: 5,
      }),
    ).toBe(false);
    expect(
      isCustomerVisibleProduct({
        isDeleted: false,
        status: ProductStatus.active,
        categoryId: 1,
      }),
    ).toBe(false);
    expect(
      isCustomerVisibleProduct({
        isDeleted: false,
        status: ProductStatus.inactive,
        categoryId: 5,
      }),
    ).toBe(false);
  });

  it('accepts active non-stub non-deleted products', () => {
    expect(
      isCustomerVisibleProduct({
        isDeleted: false,
        status: ProductStatus.active,
        categoryId: 5,
      }),
    ).toBe(true);
  });

  it('does not require curated membership for direct PDP visibility', () => {
    expect(
      isCustomerVisibleProduct({
        isDeleted: false,
        status: ProductStatus.active,
        categoryId: 5,
      }),
    ).toBe(true);
  });
});
