import {
  groupUpdateRequiresDisableCapability,
  pavMutationRequiresInventoryCapability,
  pavMutationRequiresPriceCapability,
} from './product-mutation-capability.util';

describe('product-mutation-capability.util (ADMIN-RBAC-1)', () => {
  describe('PAV price', () => {
    it('write-only metadata does not require product.price', () => {
      expect(
        pavMutationRequiresPriceCapability(
          { price: undefined, discountedPrice: undefined },
          { price: 100, discountedPrice: 80 },
        ),
      ).toBe(false);
    });

    it('unchanged price values do not require product.price', () => {
      expect(
        pavMutationRequiresPriceCapability(
          { price: 100, discountedPrice: 80 },
          { price: 100, discountedPrice: 80 },
        ),
      ).toBe(false);
    });

    it('price change requires product.price', () => {
      expect(
        pavMutationRequiresPriceCapability(
          { price: 120 },
          { price: 100, discountedPrice: 80 },
        ),
      ).toBe(true);
    });

    it('discountedPrice change requires product.price', () => {
      expect(
        pavMutationRequiresPriceCapability(
          { discountedPrice: 70 },
          { price: 100, discountedPrice: 80 },
        ),
      ).toBe(true);
    });

    it('create with explicit price requires product.price', () => {
      expect(
        pavMutationRequiresPriceCapability({ price: 50 }, null),
      ).toBe(true);
    });

    it('create without price does not require product.price', () => {
      expect(pavMutationRequiresPriceCapability({}, null)).toBe(false);
    });
  });

  describe('PAV inventory', () => {
    it('omitted quantity does not require product.inventory', () => {
      expect(
        pavMutationRequiresInventoryCapability({}, { quantity: 5 }),
      ).toBe(false);
      expect(pavMutationRequiresInventoryCapability({}, null)).toBe(false);
    });

    it('unchanged quantity does not require product.inventory', () => {
      expect(
        pavMutationRequiresInventoryCapability(
          { quantity: 5 },
          { quantity: 5 },
        ),
      ).toBe(false);
    });

    it('quantity change requires product.inventory', () => {
      expect(
        pavMutationRequiresInventoryCapability(
          { quantity: 1 },
          { quantity: 5 },
        ),
      ).toBe(true);
    });

    it('create with explicit quantity requires product.inventory', () => {
      expect(
        pavMutationRequiresInventoryCapability({ quantity: -1 }, null),
      ).toBe(true);
    });
  });

  describe('group status', () => {
    it('status mutation requires product.disable', () => {
      expect(groupUpdateRequiresDisableCapability({ status: 'inactive' })).toBe(
        true,
      );
      expect(groupUpdateRequiresDisableCapability({ status: 'active' })).toBe(
        true,
      );
      expect(groupUpdateRequiresDisableCapability({ status: 'draft' })).toBe(
        true,
      );
    });

    it('non-status group fields do not require product.disable', () => {
      expect(groupUpdateRequiresDisableCapability({})).toBe(false);
      expect(groupUpdateRequiresDisableCapability({ status: null })).toBe(
        false,
      );
      expect(groupUpdateRequiresDisableCapability({ status: '' })).toBe(false);
    });
  });
});
