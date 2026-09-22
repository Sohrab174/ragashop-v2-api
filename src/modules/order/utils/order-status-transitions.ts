import { OrderStatus } from '../entities/order.entity';

/**
 * Phase C1 lifecycle policy.
 *
 * Reservation-bearing unpaid state: pending only.
 * Paid/finalized: paid (set by payment finalization, not admin updateStatus).
 * Fulfillment: accepted / sent / delivered / buyFromSource / sendToDestination
 *   — only reachable after paid (or from other fulfillment states).
 * Terminal unpaid release: rejected (inventory restored exactly once from pending).
 *
 * Re-entry into pending is never allowed (prevents ABA double-restore and
 * payment-without-reservation).
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.pending]: [OrderStatus.rejected],
  [OrderStatus.paid]: [
    OrderStatus.accepted,
    OrderStatus.sent,
    OrderStatus.delivered,
    OrderStatus.buyFromSource,
    OrderStatus.sendToDestination,
    OrderStatus.rejected,
  ],
  [OrderStatus.accepted]: [
    OrderStatus.sent,
    OrderStatus.delivered,
    OrderStatus.buyFromSource,
    OrderStatus.sendToDestination,
    OrderStatus.rejected,
  ],
  [OrderStatus.sent]: [
    OrderStatus.delivered,
    OrderStatus.buyFromSource,
    OrderStatus.sendToDestination,
  ],
  [OrderStatus.delivered]: [],
  [OrderStatus.buyFromSource]: [
    OrderStatus.sendToDestination,
    OrderStatus.sent,
    OrderStatus.delivered,
  ],
  [OrderStatus.sendToDestination]: [
    OrderStatus.sent,
    OrderStatus.delivered,
  ],
  [OrderStatus.rejected]: [],
};

export function isOrderStatusTransitionAllowed(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  if (from === to) {
    return true;
  }
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

export function assertOrderStatusTransition(
  from: OrderStatus,
  to: OrderStatus,
  error: { unprocessableEntity: (messages: string[]) => never },
): void {
  if (!isOrderStatusTransitionAllowed(from, to)) {
    error.unprocessableEntity(['تغییر وضعیت سفارش مجاز نیست']);
  }
}

/** Admin line rewrite may only edit reservation-bearing unpaid orders. */
export function isAdminOrderRewriteAllowed(status: OrderStatus): boolean {
  return status === OrderStatus.pending;
}
