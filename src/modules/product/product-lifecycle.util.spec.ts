import {
  assertProductEligibleForChildMutation,
  groupMutationEligibilityWhere,
  isProductEligibleForChildMutation,
  productUpdateEligibilityWhere,
} from './product-lifecycle.util';
import { ProductStatus } from './entities/product.entity';

describe('product-lifecycle.util', () => {
  it('rejects deleted Products for child mutation', () => {
    expect(isProductEligibleForChildMutation({ isDeleted: true })).toBe(false);
    expect(isProductEligibleForChildMutation({ isDeleted: false })).toBe(true);
  });

  it('assertProductEligibleForChildMutation throws for deleted Product', () => {
    const error = {
      unprocessableEntity: (messages: string[]) => {
        throw new Error(messages[0]);
      },
    };
    expect(() =>
      assertProductEligibleForChildMutation({ isDeleted: true }, error),
    ).toThrow('محصول حذف شده است.');
  });

  it('productUpdateEligibilityWhere requires non-deleted row', () => {
    expect(productUpdateEligibilityWhere(42)).toEqual({
      id: 42,
      isDeleted: false,
    });
  });

  it('groupMutationEligibilityWhere excludes deleted Products', () => {
    expect(groupMutationEligibilityWhere()).toEqual({ isDeleted: false });
  });

  it('allows active non-deleted Products', () => {
    expect(
      isProductEligibleForChildMutation({
        isDeleted: false,
        status: ProductStatus.active,
      }),
    ).toBe(true);
  });
});
