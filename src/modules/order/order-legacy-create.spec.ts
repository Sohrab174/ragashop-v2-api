import { GoneException } from '@nestjs/common';
import { OrderController } from './order.controller';

describe('POST /orders/me legacy customer create — disabled', () => {
  it('throws GoneException and never calls OrderService.addUpdate', () => {
    const addUpdate = jest.fn();
    const controller = new OrderController(
      { addUpdate } as any,
      {} as any,
      {} as any,
    );

    expect(() => controller.legacyCustomerCreateDisabled()).toThrow(
      GoneException,
    );
    try {
      controller.legacyCustomerCreateDisabled();
    } catch (err) {
      expect(err).toBeInstanceOf(GoneException);
      const body = (err as GoneException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body).toMatchObject({
        success: false,
        data: { code: 'legacy_order_create_disabled' },
      });
    }
    expect(addUpdate).not.toHaveBeenCalled();
  });

  it('keeps customer order READ handlers present', () => {
    expect(typeof OrderController.prototype.getAll).toBe('function');
    expect(typeof OrderController.prototype.getById).toBe('function');
  });
});
