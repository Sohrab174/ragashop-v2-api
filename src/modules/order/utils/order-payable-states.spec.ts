import {
  isOrderAlreadyPaid,
  isOrderPaymentInitiatable,
  ORDER_PAYMENT_INITIATABLE_STATES,
} from './order-payable-states';
import { OrderStatus } from '../entities/order.entity';

describe('order payable states', () => {
  it('allows payment only from pending', () => {
    expect(ORDER_PAYMENT_INITIATABLE_STATES).toEqual([OrderStatus.pending]);
    expect(isOrderPaymentInitiatable(OrderStatus.pending)).toBe(true);
  });

  it('rejects rejected and post-payment states', () => {
    expect(isOrderPaymentInitiatable(OrderStatus.rejected)).toBe(false);
    expect(isOrderPaymentInitiatable(OrderStatus.paid)).toBe(false);
    expect(isOrderPaymentInitiatable(OrderStatus.sent)).toBe(false);
    expect(isOrderAlreadyPaid(OrderStatus.paid)).toBe(true);
  });
});
