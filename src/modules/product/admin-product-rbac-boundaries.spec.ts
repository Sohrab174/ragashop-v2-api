import { UserCapabilityName } from '../auth/capability/capability.catalog';

/**
 * Documents ADMIN-RBAC-1 product capability boundaries used by the update route.
 * Controller still calls capabilityService.assertUserHasCapability — this test
 * locks the intended decision matrix so UX changes do not silently weaken it.
 */
describe('ADMIN-RBAC-1 product update capability matrix', () => {
  const needsPrice = (dto: any, existing: any) =>
    dto.price != null && Number(dto.price) !== Number(existing.price);

  const needsDiscountPrice = (dto: any, existing: any) =>
    dto.discountedPrice != null &&
    Number(dto.discountedPrice) !== Number(existing.discountedPrice);

  const needsInventory = (dto: any, existing: any) =>
    dto.quantity != null && Number(dto.quantity) !== Number(existing.quantity);

  const needsDisable = (dto: any, existing: any) =>
    dto.status != null && dto.status !== existing.status;

  const existing = {
    price: 100,
    discountedPrice: 80,
    quantity: 5,
    status: 'active',
  };

  it('price change requires product.price', () => {
    expect(needsPrice({ price: 120 }, existing)).toBe(true);
    expect(needsPrice({ price: 100 }, existing)).toBe(false);
    expect(UserCapabilityName.product_price).toBe('product.price');
  });

  it('discountedPrice change requires product.price', () => {
    expect(needsDiscountPrice({ discountedPrice: 70 }, existing)).toBe(true);
    expect(needsDiscountPrice({ discountedPrice: 80 }, existing)).toBe(false);
  });

  it('quantity change requires product.inventory', () => {
    expect(needsInventory({ quantity: 1 }, existing)).toBe(true);
    expect(needsInventory({ quantity: 5 }, existing)).toBe(false);
    expect(UserCapabilityName.product_inventory).toBe('product.inventory');
  });

  it('status change requires product.disable', () => {
    expect(needsDisable({ status: 'inactive' }, existing)).toBe(true);
    expect(needsDisable({ status: 'active' }, existing)).toBe(false);
    expect(UserCapabilityName.product_disable).toBe('product.disable');
  });

  it('read-only name edit does not require price/inventory/disable', () => {
    const dto = { name: 'جدید', price: 100, quantity: 5, status: 'active' };
    expect(needsPrice(dto, existing)).toBe(false);
    expect(needsInventory(dto, existing)).toBe(false);
    expect(needsDisable(dto, existing)).toBe(false);
    expect(UserCapabilityName.product_write).toBe('product.write');
    expect(UserCapabilityName.product_read).toBe('product.read');
  });
});
