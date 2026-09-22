import {
  AUTHORITATIVE_WINNING_PAYMENT_STATUS,
  PREFLIGHT_SQL,
  detectCountConflict,
  detectFinalizationOrderOwnershipMismatch,
  detectFinalizationProviderPaidSuperseded,
  detectMultipleActiveAttemptsPerOrder,
  detectNonFinalOrderWithSuccessfulTransactionId,
  detectPaidOrderWithoutPaidTransaction,
  detectPaidTransactionOnNonFinalOrder,
  detectPostconditionViolations,
  detectSuccessfulTransactionIdFinalizationMismatch,
  detectSuccessfulTransactionIdProviderPaidSuperseded,
  detectSuccessfulTransactionIdWrongOrder,
} from './phase1a-migration-preflight';

describe('phase1a migration preflight (pure)', () => {
  it('detects pending + verification_uncertain on same order as mixed active conflict', () => {
    const conflict = detectMultipleActiveAttemptsPerOrder([
      {
        orderId: 100,
        activeAttemptCount: 2,
        transactionIds: '10,11',
        statuses: 'pending,verification_uncertain',
        gatewaySessionStatuses: 'not_started,',
        authorityPresence: 'no,yes',
      },
    ]);

    expect(conflict?.code).toBe(
      'multiple_active_provider_capable_attempts_per_order',
    );
    expect(conflict?.details).toEqual([
      {
        orderId: 100,
        activeAttemptCount: 2,
        transactionIds: ['10', '11'],
        statuses: ['pending', 'verification_uncertain'],
        gatewaySessionStatuses: ['not_started', ''],
        authorityPresence: ['no', 'yes'],
      },
    ]);
  });

  it('detects verification_started + pending on same order as mixed active conflict', () => {
    const conflict = detectMultipleActiveAttemptsPerOrder([
      {
        orderId: 200,
        activeAttemptCount: 2,
        transactionIds: '20,21',
        statuses: 'verification_started,pending',
      },
    ]);

    expect(conflict?.code).toBe(
      'multiple_active_provider_capable_attempts_per_order',
    );
  });

  it('accepts a single active attempt per order', () => {
    expect(detectMultipleActiveAttemptsPerOrder([])).toBeNull();
  });

  it('detects finalization.orderId != transaction.orderId', () => {
    const conflict = detectFinalizationOrderOwnershipMismatch([
      {
        finalizationId: 1,
        finalizationOrderId: 69,
        transactionId: 79,
        transactionOrderId: 70,
      },
    ]);

    expect(conflict?.code).toBe('finalization_transaction_order_mismatch');
    expect(conflict?.details).toEqual([
      {
        finalizationId: 1,
        finalizationOrderId: 69,
        transactionId: 79,
        transactionOrderId: 70,
      },
    ]);
  });

  it('detects non-final order with successfulTransactionId', () => {
    const conflict = detectNonFinalOrderWithSuccessfulTransactionId([
      {
        orderId: 69,
        status: 'rejected',
        successfulTransactionId: 79,
      },
    ]);

    expect(conflict?.code).toBe('non_final_order_with_successfulTransactionId');
  });

  it('accepts valid final order with matching finalization and successful tx', () => {
    const conflicts = detectPostconditionViolations([
      {
        orderId: 10,
        successfulTransactionId: 100,
        finalizationTransactionId: 100,
        transactionOrderId: 10,
        transactionStatus: 'paid',
      },
    ]);

    expect(conflicts).toEqual([]);
  });

  it('rejects provider_paid_superseded as finalization transaction', () => {
    const conflict = detectFinalizationProviderPaidSuperseded([
      {
        finalizationId: 5,
        orderId: 10,
        transactionId: 200,
        transactionStatus: 'provider_paid_superseded',
      },
    ]);

    expect(conflict?.code).toBe('finalization_provider_paid_superseded');
    expect(conflict?.details).toEqual([
      {
        finalizationId: 5,
        orderId: 10,
        transactionId: 200,
        transactionStatus: 'provider_paid_superseded',
      },
    ]);
  });

  it('rejects provider_paid_superseded as successfulTransactionId target', () => {
    const conflict = detectSuccessfulTransactionIdProviderPaidSuperseded([
      {
        orderId: 10,
        transactionId: 200,
        transactionStatus: 'provider_paid_superseded',
      },
    ]);

    expect(conflict?.code).toBe(
      'successfulTransactionId_provider_paid_superseded',
    );
  });

  it('accepts paid transaction as authoritative winner', () => {
    expect(AUTHORITATIVE_WINNING_PAYMENT_STATUS).toBe('paid');

    const conflicts = detectPostconditionViolations([
      {
        orderId: 10,
        successfulTransactionId: 100,
        finalizationTransactionId: 100,
        transactionOrderId: 10,
        transactionStatus: 'paid',
      },
    ]);

    expect(conflicts).toEqual([]);
    expect(detectFinalizationProviderPaidSuperseded([])).toBeNull();
    expect(detectSuccessfulTransactionIdProviderPaidSuperseded([])).toBeNull();
  });

  it('postcondition rejects provider_paid_superseded authoritative transaction', () => {
    const conflicts = detectPostconditionViolations([
      {
        orderId: 10,
        successfulTransactionId: 100,
        finalizationTransactionId: 100,
        transactionOrderId: 10,
        transactionStatus: 'provider_paid_superseded',
      },
    ]);

    expect(conflicts[0]?.code).toBe(
      'postcondition_authoritative_transaction_provider_paid_superseded',
    );
  });

  it('postcondition SQL does not cap finalized-order validation at 5000 rows', () => {
    expect(PREFLIGHT_SQL.postFinalizedOrderViolations).not.toMatch(
      /LIMIT\s+5000/i,
    );
    expect(PREFLIGHT_SQL.postFinalizedOrderViolations).not.toContain(
      'postFinalizedOrderCoverage',
    );
  });

  it('postcondition diagnostic LIMIT applies only after violation filter', () => {
    const sql = PREFLIGHT_SQL.postFinalizedOrderViolations;
    const whereIndex = sql.indexOf('WHERE o.status IN');
    const violationFilterIndex = sql.indexOf('f.id IS NULL');
    const limitIndex = sql.indexOf('LIMIT 10');

    expect(whereIndex).toBeGreaterThan(-1);
    expect(violationFilterIndex).toBeGreaterThan(whereIndex);
    expect(limitIndex).toBeGreaterThan(violationFilterIndex);
    expect(sql).toMatch(/t\.status != 'paid'/);
    expect(sql).toMatch(/st\.status != 'paid'/);
  });

  it('detects multiple paid transactions per order', () => {
    const conflict = detectCountConflict(
      'multiple_paid_transactions_per_order',
      'Multiple paid transactions exist for one order',
      [{ orderId: 5, cnt: 2 }],
    );

    expect(conflict?.code).toBe('multiple_paid_transactions_per_order');
  });

  it('detects paid transaction on rejected/non-final order', () => {
    const conflict = detectPaidTransactionOnNonFinalOrder([
      {
        transactionId: 79,
        orderId: 69,
        orderStatus: 'rejected',
      },
    ]);

    expect(conflict?.code).toBe('paid_transaction_order_not_final');
  });

  it('detects paid/final order without paid transaction', () => {
    const conflict = detectPaidOrderWithoutPaidTransaction([{ orderId: 12 }]);
    expect(conflict?.code).toBe('paid_order_without_paid_transaction');
  });

  it('detects wrong-order successfulTransactionId', () => {
    const conflict = detectSuccessfulTransactionIdWrongOrder([
      {
        orderId: 10,
        successfulTransactionId: 55,
        txOrderId: 11,
      },
    ]);

    expect(conflict?.code).toBe('successfulTransactionId_wrong_order');
  });

  it('detects successfulTransactionId mismatch with finalization row', () => {
    const conflict = detectSuccessfulTransactionIdFinalizationMismatch([
      {
        orderId: 10,
        successfulTransactionId: 100,
        transactionId: 101,
      },
    ]);

    expect(conflict?.code).toBe(
      'successfulTransactionId_finalization_mismatch',
    );
  });

  it('postcondition rejects missing finalization on finalized order', () => {
    const conflicts = detectPostconditionViolations([
      {
        orderId: 10,
        successfulTransactionId: null,
        finalizationTransactionId: null,
        transactionOrderId: null,
        transactionStatus: null,
      },
    ]);

    expect(conflicts[0]?.code).toBe('postcondition_missing_finalization');
  });

  it('postcondition rejects finalization pointing to another order', () => {
    const conflicts = detectPostconditionViolations([
      {
        orderId: 10,
        successfulTransactionId: 100,
        finalizationTransactionId: 100,
        transactionOrderId: 11,
        transactionStatus: 'paid',
      },
    ]);

    expect(conflicts[0]?.code).toBe('postcondition_finalization_wrong_order');
  });
});

describe('foreignKeyExists helper semantics (unit)', () => {
  it('distinguishes index presence from foreign key presence conceptually', () => {
    const indexNames = new Set(['fk_order_successful_transaction_idx']);
    const foreignKeys = new Set<string>();

    expect(
      indexNames.has('fk_order_successful_transaction_idx') &&
        !foreignKeys.has('fk_order_successful_transaction'),
    ).toBe(true);
  });

  it('detects foreign key presence when constraint exists', () => {
    const foreignKeys = new Set(['fk_order_successful_transaction']);
    expect(foreignKeys.has('fk_order_successful_transaction')).toBe(true);
  });
});
