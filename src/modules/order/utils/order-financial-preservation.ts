import { OrderEntity, OrderStatus } from '../entities/order.entity';
import {
  TransactionEntity,
  TransactionStatus,
} from '../../transaction/entities/transaction.entity';
import { isOrderAlreadyPaid } from './order-payable-states';

/** Transaction states that mean provider/payment evidence must be preserved. */
export const FINANCIALLY_PRESERVED_TRANSACTION_STATUSES: TransactionStatus[] = [
  TransactionStatus.paid,
  TransactionStatus.provider_paid_superseded,
  TransactionStatus.verification_started,
  TransactionStatus.verification_uncertain,
];

const FINANCIALLY_MEANINGFUL_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.accepted,
  OrderStatus.paid,
  OrderStatus.sent,
  OrderStatus.delivered,
  OrderStatus.buyFromSource,
  OrderStatus.sendToDestination,
];

export type FinancialOrderSnapshot = Pick<
  OrderEntity,
  'status' | 'successfulTransactionId' | 'finalAmount'
>;

export type FinancialTransactionSnapshot = Pick<
  TransactionEntity,
  'status' | 'paidAt'
>;

/**
 * Shared definition of payment evidence that blocks inventory release and
 * hard deletion of an unpaid pending order.
 */
export function hasTransactionFinancialEvidence(
  transactions: FinancialTransactionSnapshot[] = [],
): boolean {
  for (const tx of transactions) {
    if (FINANCIALLY_PRESERVED_TRANSACTION_STATUSES.includes(tx.status)) {
      return true;
    }
    if (tx.paidAt != null) {
      return true;
    }
  }
  return false;
}

/**
 * True when releasing reserved inventory would race provider payment /
 * reconciliation. Does not require order.status === pending (caller checks
 * reservation ownership separately).
 *
 * C2A: optional 4th arg blocks release while a manual payment hold is active
 * (SUBMITTED/UNDER_REVIEW with holdExpiresAt in the future).
 */
export function isInventoryReleaseBlocked(
  order: Pick<OrderEntity, 'successfulTransactionId'>,
  transactions: FinancialTransactionSnapshot[] = [],
  hasPaymentFinalization = false,
  activeManualPaymentHold = false,
): boolean {
  if (order.successfulTransactionId != null) {
    return true;
  }
  if (hasPaymentFinalization) {
    return true;
  }
  if (activeManualPaymentHold) {
    return true;
  }
  return hasTransactionFinancialEvidence(transactions);
}

/**
 * Phase 2B-3 / C1: block hard deletion that would destroy financial history.
 */
export function isOrderHardDeletionBlocked(
  order: FinancialOrderSnapshot,
  transactions: FinancialTransactionSnapshot[] = [],
  hasPaymentFinalization = false,
  activeManualPaymentHold = false,
): boolean {
  if (
    isInventoryReleaseBlocked(
      order,
      transactions,
      hasPaymentFinalization,
      activeManualPaymentHold,
    )
  ) {
    return true;
  }

  if (isOrderAlreadyPaid(order.status)) {
    return true;
  }

  if (FINANCIALLY_MEANINGFUL_ORDER_STATUSES.includes(order.status)) {
    return true;
  }

  return false;
}
