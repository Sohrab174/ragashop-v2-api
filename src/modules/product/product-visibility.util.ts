import { SelectQueryBuilder } from 'typeorm';
import { ProductEntity, ProductStatus } from './entities/product.entity';

const STUB_CATEGORY_ID = 1;

/**
 * Customer-visible marketplace products must be active, non-deleted, and fully categorized (not stub).
 */
export function applyCustomerVisibleProductFilters<T extends ProductEntity>(
  builder: SelectQueryBuilder<T>,
  alias = 'product',
): SelectQueryBuilder<T> {
  return builder
    .andWhere(`${alias}.isDeleted = :customerVisibleIsDeleted`, {
      customerVisibleIsDeleted: false,
    })
    .andWhere(`${alias}.status = :customerVisibleStatus`, {
      customerVisibleStatus: ProductStatus.active,
    })
    .andWhere(`${alias}.categoryId != :stubCategoryId`, {
      stubCategoryId: STUB_CATEGORY_ID,
    });
}

export function isCustomerVisibleProduct(product: {
  isDeleted?: boolean;
  status?: ProductStatus | string;
  categoryId?: number;
}): boolean {
  return (
    product?.isDeleted === false &&
    product?.status === ProductStatus.active &&
    product?.categoryId != null &&
    product.categoryId !== STUB_CATEGORY_ID
  );
}
