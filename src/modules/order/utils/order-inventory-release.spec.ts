import {
  isInventoryStillReserved,
  restoreReservedInventoryLines,
} from './order-inventory-release';
import { OrderStatus } from '../entities/order.entity';

describe('order-inventory-release helpers', () => {
  it('treats only pending as still reserved', () => {
    expect(isInventoryStillReserved(OrderStatus.pending)).toBe(true);
    expect(isInventoryStillReserved(OrderStatus.rejected)).toBe(false);
    expect(isInventoryStillReserved(OrderStatus.paid)).toBe(false);
    expect(isInventoryStillReserved(OrderStatus.accepted)).toBe(false);
  });

  it('restores product bucket for plain lines and PAV for variant lines', async () => {
    const productService = {
      incrementQuantity: jest.fn().mockResolvedValue(undefined),
      incrementAttributeQuantity: jest.fn().mockResolvedValue(undefined),
    };
    const queryRunner = {} as any;

    await restoreReservedInventoryLines(
      productService,
      [
        { productId: 10, productAttributeValueId: null, quantity: 2 },
        { productId: 11, productAttributeValueId: 55, quantity: 3 },
      ],
      queryRunner,
    );

    expect(productService.incrementQuantity).toHaveBeenCalledTimes(1);
    expect(productService.incrementQuantity).toHaveBeenCalledWith(
      10,
      2,
      queryRunner,
    );
    expect(productService.incrementAttributeQuantity).toHaveBeenCalledTimes(1);
    expect(productService.incrementAttributeQuantity).toHaveBeenCalledWith(
      55,
      3,
      queryRunner,
    );
  });

  it('does not bump product when PAV id is set', async () => {
    const productService = {
      incrementQuantity: jest.fn().mockResolvedValue(undefined),
      incrementAttributeQuantity: jest.fn().mockResolvedValue(undefined),
    };

    await restoreReservedInventoryLines(
      productService,
      [{ productId: 10, productAttributeValueId: 99, quantity: 1 }],
      {} as any,
    );

    expect(productService.incrementQuantity).not.toHaveBeenCalled();
    expect(productService.incrementAttributeQuantity).toHaveBeenCalledWith(
      99,
      1,
      expect.anything(),
    );
  });
});
