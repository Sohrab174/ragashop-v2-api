import { OrderStatus } from '../entities/order.entity';
import {
  assertOrderStatusTransition,
  isAdminOrderRewriteAllowed,
  isOrderStatusTransitionAllowed,
} from './order-status-transitions';

describe('order-status-transitions C1 lifecycle', () => {
  it('allows pending → rejected', () => {
    expect(
      isOrderStatusTransitionAllowed(OrderStatus.pending, OrderStatus.rejected),
    ).toBe(true);
  });

  it('blocks pending → accepted (unpaid fulfillment leak)', () => {
    expect(
      isOrderStatusTransitionAllowed(OrderStatus.pending, OrderStatus.accepted),
    ).toBe(false);
  });

  it('blocks pending → paid via admin status path', () => {
    expect(
      isOrderStatusTransitionAllowed(OrderStatus.pending, OrderStatus.paid),
    ).toBe(false);
  });

  it('blocks paid → pending ABA', () => {
    expect(
      isOrderStatusTransitionAllowed(OrderStatus.paid, OrderStatus.pending),
    ).toBe(false);
  });

  it('blocks rejected → pending ABA', () => {
    expect(
      isOrderStatusTransitionAllowed(OrderStatus.rejected, OrderStatus.pending),
    ).toBe(false);
  });

  it('allows paid → accepted / sent / delivered', () => {
    expect(
      isOrderStatusTransitionAllowed(OrderStatus.paid, OrderStatus.accepted),
    ).toBe(true);
    expect(
      isOrderStatusTransitionAllowed(OrderStatus.paid, OrderStatus.sent),
    ).toBe(true);
    expect(
      isOrderStatusTransitionAllowed(OrderStatus.paid, OrderStatus.delivered),
    ).toBe(true);
  });

  it('allows idempotent same-status', () => {
    expect(
      isOrderStatusTransitionAllowed(OrderStatus.rejected, OrderStatus.rejected),
    ).toBe(true);
  });

  it('assert throws on illegal transition', () => {
    const error = {
      unprocessableEntity: jest.fn((msgs) => {
        throw new Error(msgs[0]);
      }),
    };
    expect(() =>
      assertOrderStatusTransition(
        OrderStatus.rejected,
        OrderStatus.pending,
        error as any,
      ),
    ).toThrow();
  });

  it('admin rewrite only allowed while pending', () => {
    expect(isAdminOrderRewriteAllowed(OrderStatus.pending)).toBe(true);
    expect(isAdminOrderRewriteAllowed(OrderStatus.rejected)).toBe(false);
    expect(isAdminOrderRewriteAllowed(OrderStatus.paid)).toBe(false);
    expect(isAdminOrderRewriteAllowed(OrderStatus.accepted)).toBe(false);
  });
});
