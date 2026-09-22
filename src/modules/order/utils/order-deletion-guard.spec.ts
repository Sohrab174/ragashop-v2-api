import { isOrderHardDeletionBlocked } from './order-deletion-guard';
import { OrderStatus } from '../entities/order.entity';
import { TransactionStatus } from '../../transaction/entities/transaction.entity';

describe('isOrderHardDeletionBlocked', () => {
  it('blocks paid orders', () => {
    expect(
      isOrderHardDeletionBlocked(
        {
          status: OrderStatus.paid,
          successfulTransactionId: null,
          finalAmount: 100,
        },
        [],
      ),
    ).toBe(true);
  });

  it('blocks orders with successful transaction reference', () => {
    expect(
      isOrderHardDeletionBlocked(
        {
          status: OrderStatus.pending,
          successfulTransactionId: 9,
          finalAmount: 0,
        },
        [],
      ),
    ).toBe(true);
  });

  it('blocks orders with paid transaction history', () => {
    expect(
      isOrderHardDeletionBlocked(
        {
          status: OrderStatus.pending,
          successfulTransactionId: null,
          finalAmount: 0,
        },
        [{ status: TransactionStatus.paid, paidAt: new Date() }],
      ),
    ).toBe(true);
  });

  it('allows pending unpaid orders with only failed transactions', () => {
    expect(
      isOrderHardDeletionBlocked(
        {
          status: OrderStatus.pending,
          successfulTransactionId: null,
          finalAmount: 0,
        },
        [{ status: TransactionStatus.failed, paidAt: null }],
      ),
    ).toBe(false);
  });

  it('blocks when payment finalization claim exists', () => {
    expect(
      isOrderHardDeletionBlocked(
        {
          status: OrderStatus.pending,
          successfulTransactionId: null,
          finalAmount: 0,
        },
        [],
        true,
      ),
    ).toBe(true);
  });
});
