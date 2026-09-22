import {
  hasTransactionFinancialEvidence,
  isInventoryReleaseBlocked,
  isOrderHardDeletionBlocked,
} from './order-financial-preservation';
import { OrderStatus } from '../entities/order.entity';
import { TransactionStatus } from '../../transaction/entities/transaction.entity';

describe('order-financial-preservation', () => {
  const pending = {
    status: OrderStatus.pending,
    successfulTransactionId: null as number | null,
    finalAmount: 100,
  };

  it('blocks release on verification_started', () => {
    expect(
      isInventoryReleaseBlocked(pending, [
        { status: TransactionStatus.verification_started, paidAt: null },
      ]),
    ).toBe(true);
  });

  it('blocks release on verification_uncertain', () => {
    expect(
      isInventoryReleaseBlocked(pending, [
        { status: TransactionStatus.verification_uncertain, paidAt: null },
      ]),
    ).toBe(true);
  });

  it('blocks release on provider_paid_superseded', () => {
    expect(
      isInventoryReleaseBlocked(pending, [
        {
          status: TransactionStatus.provider_paid_superseded,
          paidAt: new Date(),
        },
      ]),
    ).toBe(true);
  });

  it('blocks release when payment finalization claim exists', () => {
    expect(isInventoryReleaseBlocked(pending, [], true)).toBe(true);
  });

  it('blocks release when active manual payment hold is set', () => {
    expect(isInventoryReleaseBlocked(pending, [], false, true)).toBe(true);
  });

  it('allows release when hold arg is false and no other evidence', () => {
    expect(isInventoryReleaseBlocked(pending, [], false, false)).toBe(false);
  });

  it('allows release for pending with only failed txs', () => {
    expect(
      isInventoryReleaseBlocked(pending, [
        { status: TransactionStatus.failed, paidAt: null },
      ]),
    ).toBe(false);
  });

  it('hard deletion blocked by active manual hold', () => {
    expect(
      isOrderHardDeletionBlocked(pending, [], false, true),
    ).toBe(true);
  });

  it('hasTransactionFinancialEvidence ignores plain pending', () => {
    expect(
      hasTransactionFinancialEvidence([
        { status: TransactionStatus.pending, paidAt: null },
      ]),
    ).toBe(false);
  });

  it('deletion blocked for accepted even without txs', () => {
    expect(
      isOrderHardDeletionBlocked(
        {
          status: OrderStatus.accepted,
          successfulTransactionId: null,
          finalAmount: 1,
        },
        [],
      ),
    ).toBe(true);
  });
});
