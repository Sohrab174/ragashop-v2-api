import { OrderStatus } from '../entities/order.entity';

/** States from which a customer may initiate payment. */
export const ORDER_PAYMENT_INITIATABLE_STATES: OrderStatus[] = [
  OrderStatus.pending,
];

/** States that may transition to paid via successful payment. */
export const ORDER_COMPLETABLE_STATES: OrderStatus[] = [OrderStatus.pending];

export function isOrderPaymentInitiatable(status: OrderStatus): boolean {
  return ORDER_PAYMENT_INITIATABLE_STATES.includes(status);
}

export function isOrderAlreadyPaid(status: OrderStatus): boolean {
  return (
    status === OrderStatus.paid ||
    status === OrderStatus.sent ||
    status === OrderStatus.delivered
  );
}
