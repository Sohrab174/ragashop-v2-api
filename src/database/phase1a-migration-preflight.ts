export const ACTIVE_PROVIDER_CAPABLE_STATUSES = [
  'pending',
  'verification_started',
  'verification_uncertain',
] as const;

export const FINALIZED_ORDER_STATUSES = ['paid', 'sent', 'delivered'] as const;

/** Authoritative winning payment for finalization / successfulTransactionId. */
export const AUTHORITATIVE_WINNING_PAYMENT_STATUS = 'paid' as const;

export const SUCCESSFUL_PAYMENT_TRANSACTION_STATUSES = [
  AUTHORITATIVE_WINNING_PAYMENT_STATUS,
] as const;

export type MigrationPreflightConflict = {
  code: string;
  message: string;
  details: unknown;
};

export type ActiveAttemptRow = {
  orderId: number;
  activeAttemptCount: number | string;
  transactionIds?: string;
  statuses?: string;
  gatewaySessionStatuses?: string;
  authorityPresence?: string;
};

export type FinalizationOwnershipRow = {
  finalizationId: number;
  finalizationOrderId: number;
  transactionId: number;
  transactionOrderId: number;
};

export type OrderSuccessfulTxRow = {
  orderId: number;
  status: string;
  successfulTransactionId: number;
};

export type PaidTransactionOrderRow = {
  transactionId: number;
  orderId: number;
  orderStatus: string;
};

export type ProviderPaidSupersededAuthoritativeRow = {
  finalizationId?: number | null;
  orderId: number;
  transactionId: number;
  transactionStatus: string;
};

export type FinalizedOrderCoverageRow = {
  orderId: number;
  successfulTransactionId: number | null;
  finalizationTransactionId: number | null;
  transactionOrderId: number | null;
  transactionStatus: string | null;
};

export function detectFinalizationProviderPaidSuperseded(
  rows: ProviderPaidSupersededAuthoritativeRow[],
): MigrationPreflightConflict | null {
  if (!rows?.length) {
    return null;
  }

  return {
    code: 'finalization_provider_paid_superseded',
    message:
      'order_payment_finalization must not reference provider_paid_superseded transaction',
    details: rows.map((row) => ({
      finalizationId: row.finalizationId ?? null,
      orderId: row.orderId,
      transactionId: row.transactionId,
      transactionStatus: row.transactionStatus,
    })),
  };
}

export function detectSuccessfulTransactionIdProviderPaidSuperseded(
  rows: ProviderPaidSupersededAuthoritativeRow[],
): MigrationPreflightConflict | null {
  if (!rows?.length) {
    return null;
  }

  return {
    code: 'successfulTransactionId_provider_paid_superseded',
    message:
      'order.successfulTransactionId must not reference provider_paid_superseded transaction',
    details: rows.map((row) => ({
      orderId: row.orderId,
      transactionId: row.transactionId,
      transactionStatus: row.transactionStatus,
    })),
  };
}

export function detectMultipleActiveAttemptsPerOrder(
  rows: ActiveAttemptRow[],
): MigrationPreflightConflict | null {
  if (!rows?.length) {
    return null;
  }

  return {
    code: 'multiple_active_provider_capable_attempts_per_order',
    message:
      'Multiple active provider-capable payment attempts exist for the same order',
    details: rows.map((row) => ({
      orderId: row.orderId,
      activeAttemptCount: Number(row.activeAttemptCount),
      transactionIds: row.transactionIds?.split(',') ?? [],
      statuses: row.statuses?.split(',') ?? [],
      gatewaySessionStatuses: row.gatewaySessionStatuses?.split(',') ?? [],
      authorityPresence: row.authorityPresence?.split(',') ?? [],
    })),
  };
}

export function detectFinalizationOrderOwnershipMismatch(
  rows: FinalizationOwnershipRow[],
): MigrationPreflightConflict | null {
  if (!rows?.length) {
    return null;
  }

  return {
    code: 'finalization_transaction_order_mismatch',
    message:
      'order_payment_finalization.orderId must equal transaction.orderId',
    details: rows,
  };
}

export function detectNonFinalOrderWithSuccessfulTransactionId(
  rows: OrderSuccessfulTxRow[],
): MigrationPreflightConflict | null {
  if (!rows?.length) {
    return null;
  }

  return {
    code: 'non_final_order_with_successfulTransactionId',
    message: 'Non-final orders must not retain successfulTransactionId',
    details: rows,
  };
}

export function detectCountConflict(
  code: string,
  message: string,
  rows: Array<{ orderId: number; cnt: number | string }>,
): MigrationPreflightConflict | null {
  if (!rows?.length) {
    return null;
  }

  return {
    code,
    message,
    details: rows,
  };
}

export function detectPaidTransactionOnNonFinalOrder(
  rows: PaidTransactionOrderRow[],
): MigrationPreflightConflict | null {
  if (!rows?.length) {
    return null;
  }

  return {
    code: 'paid_transaction_order_not_final',
    message: 'Paid transaction exists for a non-final order',
    details: rows,
  };
}

export function detectPaidOrderWithoutPaidTransaction(
  rows: Array<{ orderId: number }>,
): MigrationPreflightConflict | null {
  if (!rows?.length) {
    return null;
  }

  return {
    code: 'paid_order_without_paid_transaction',
    message: 'Finalized order has no paid transaction',
    details: rows,
  };
}

export function detectFinalizationTransactionNotSuccessful(
  rows: Array<{
    orderId: number;
    transactionId: number;
    status: string | null;
  }>,
): MigrationPreflightConflict | null {
  if (!rows?.length) {
    return null;
  }

  return {
    code: 'finalization_transaction_not_successful',
    message:
      'order_payment_finalization must reference an existing successful payment transaction',
    details: rows,
  };
}

export function detectSuccessfulTransactionIdFinalizationMismatch(
  rows: Array<{
    orderId: number;
    successfulTransactionId: number;
    transactionId: number;
  }>,
): MigrationPreflightConflict | null {
  if (!rows?.length) {
    return null;
  }

  return {
    code: 'successfulTransactionId_finalization_mismatch',
    message:
      'order.successfulTransactionId must equal order_payment_finalization.transactionId',
    details: rows,
  };
}

export function detectSuccessfulTransactionIdWrongOrder(
  rows: Array<{
    orderId: number;
    successfulTransactionId: number;
    txOrderId: number;
  }>,
): MigrationPreflightConflict | null {
  if (!rows?.length) {
    return null;
  }

  return {
    code: 'successfulTransactionId_wrong_order',
    message: 'order.successfulTransactionId must belong to the same order',
    details: rows,
  };
}

export function detectPostconditionViolations(
  rows: FinalizedOrderCoverageRow[],
): MigrationPreflightConflict[] {
  const conflicts: MigrationPreflightConflict[] = [];

  for (const row of rows) {
    if (row.finalizationTransactionId == null) {
      conflicts.push({
        code: 'postcondition_missing_finalization',
        message: 'Finalized order is missing order_payment_finalization row',
        details: { orderId: row.orderId },
      });
      continue;
    }

    if (row.successfulTransactionId == null) {
      conflicts.push({
        code: 'postcondition_missing_successfulTransactionId',
        message: 'Finalized order is missing successfulTransactionId',
        details: { orderId: row.orderId },
      });
      continue;
    }

    if (+row.successfulTransactionId !== +row.finalizationTransactionId) {
      conflicts.push({
        code: 'postcondition_successfulTransactionId_mismatch',
        message:
          'successfulTransactionId must equal finalization.transactionId',
        details: row,
      });
    }

    if (row.transactionOrderId == null || row.transactionStatus == null) {
      conflicts.push({
        code: 'postcondition_missing_successful_transaction',
        message: 'Finalization references a missing transaction',
        details: row,
      });
      continue;
    }

    if (+row.transactionOrderId !== +row.orderId) {
      conflicts.push({
        code: 'postcondition_finalization_wrong_order',
        message: 'Finalization transaction belongs to a different order',
        details: row,
      });
    }

    if (row.transactionStatus !== AUTHORITATIVE_WINNING_PAYMENT_STATUS) {
      conflicts.push({
        code:
          row.transactionStatus === 'provider_paid_superseded'
            ? 'postcondition_authoritative_transaction_provider_paid_superseded'
            : 'postcondition_transaction_not_successful',
        message:
          row.transactionStatus === 'provider_paid_superseded'
            ? 'Authoritative finalization transaction must not be provider_paid_superseded'
            : 'Finalization transaction is not in a successful payment state',
        details: row,
      });
    }
  }

  return conflicts;
}

export function formatMigrationBlockedError(
  phase: 'PREFLIGHT' | 'POSTCONDITION',
  conflict: MigrationPreflightConflict,
): string {
  return `PHASE1A_FIX_PASS3_MIGRATION_${phase}_BLOCKED (${
    conflict.code
  }): ${JSON.stringify(conflict.details)}`;
}

export const PREFLIGHT_SQL = {
  multiplePaidPerOrder: `
    SELECT orderId, COUNT(*) AS cnt
    FROM transaction
    WHERE status = 'paid'
    GROUP BY orderId
    HAVING COUNT(*) > 1
    LIMIT 10;
  `,
  multipleActiveAttemptsPerOrder: `
    SELECT
      t.orderId,
      COUNT(*) AS activeAttemptCount,
      GROUP_CONCAT(t.id ORDER BY t.id) AS transactionIds,
      GROUP_CONCAT(t.status ORDER BY t.id) AS statuses,
      GROUP_CONCAT(COALESCE(t.gatewaySessionStatus, '') ORDER BY t.id) AS gatewaySessionStatuses,
      GROUP_CONCAT(
        CASE
          WHEN t.randomToken IS NOT NULL AND t.randomToken != '' THEN 'yes'
          ELSE 'no'
        END
        ORDER BY t.id
      ) AS authorityPresence
    FROM transaction t
    WHERE t.status IN ('pending', 'verification_started', 'verification_uncertain')
    GROUP BY t.orderId
    HAVING COUNT(*) > 1
    LIMIT 10;
  `,
  paidOrderWithoutPaidTransaction: `
    SELECT o.id AS orderId
    FROM \`order\` o
    WHERE o.status IN ('paid','sent','delivered')
      AND NOT EXISTS (
        SELECT 1 FROM transaction t
        WHERE t.orderId = o.id AND t.status = 'paid'
      )
    LIMIT 10;
  `,
  paidTransactionOnNonFinalOrder: `
    SELECT t.id AS transactionId, t.orderId, o.status AS orderStatus
    FROM transaction t
    INNER JOIN \`order\` o ON o.id = t.orderId
    WHERE t.status = 'paid'
      AND o.status NOT IN ('paid','sent','delivered')
    LIMIT 10;
  `,
  finalizationOrderOwnershipMismatch: `
    SELECT
      f.id AS finalizationId,
      f.orderId AS finalizationOrderId,
      f.transactionId,
      t.orderId AS transactionOrderId
    FROM order_payment_finalization f
    INNER JOIN transaction t ON t.id = f.transactionId
    WHERE f.orderId != t.orderId
    LIMIT 10;
  `,
  finalizationTransactionNotSuccessful: `
    SELECT f.orderId, f.transactionId, t.status
    FROM order_payment_finalization f
    LEFT JOIN transaction t ON t.id = f.transactionId
    WHERE t.id IS NULL
      OR t.status != 'paid'
    LIMIT 10;
  `,
  finalizationProviderPaidSuperseded: `
    SELECT f.id AS finalizationId, f.orderId, f.transactionId, t.status AS transactionStatus
    FROM order_payment_finalization f
    INNER JOIN transaction t ON t.id = f.transactionId
    WHERE t.status = 'provider_paid_superseded'
    LIMIT 10;
  `,
  successfulTransactionIdProviderPaidSuperseded: `
    SELECT o.id AS orderId, o.successfulTransactionId AS transactionId, t.status AS transactionStatus
    FROM \`order\` o
    INNER JOIN transaction t ON t.id = o.successfulTransactionId
    WHERE t.status = 'provider_paid_superseded'
    LIMIT 10;
  `,
  nonFinalOrderWithSuccessfulTransactionId: `
    SELECT o.id AS orderId, o.status, o.successfulTransactionId
    FROM \`order\` o
    WHERE o.successfulTransactionId IS NOT NULL
      AND o.status NOT IN ('paid','sent','delivered')
    LIMIT 10;
  `,
  successfulTransactionIdFinalizationMismatch: `
    SELECT o.id AS orderId, o.successfulTransactionId, f.transactionId
    FROM \`order\` o
    INNER JOIN order_payment_finalization f ON f.orderId = o.id
    WHERE o.successfulTransactionId IS NOT NULL
      AND o.successfulTransactionId != f.transactionId
    LIMIT 10;
  `,
  successfulTransactionIdWrongOrder: `
    SELECT o.id AS orderId, o.successfulTransactionId, t.orderId AS txOrderId
    FROM \`order\` o
    INNER JOIN transaction t ON t.id = o.successfulTransactionId
    WHERE t.orderId != o.id
    LIMIT 10;
  `,
  postFinalizedOrderViolations: `
    SELECT
      o.id AS orderId,
      o.successfulTransactionId,
      f.id AS finalizationId,
      f.transactionId AS finalizationTransactionId,
      t.orderId AS transactionOrderId,
      t.status AS transactionStatus
    FROM \`order\` o
    LEFT JOIN order_payment_finalization f ON f.orderId = o.id
    LEFT JOIN transaction t ON t.id = f.transactionId
    LEFT JOIN transaction st ON st.id = o.successfulTransactionId
    WHERE o.status IN ('paid','sent','delivered')
      AND (
        f.id IS NULL
        OR o.successfulTransactionId IS NULL
        OR o.successfulTransactionId != f.transactionId
        OR t.id IS NULL
        OR t.orderId != o.id
        OR t.status != 'paid'
        OR st.id IS NULL
        OR st.orderId != o.id
        OR st.status != 'paid'
      )
    LIMIT 10;
  `,
  postNonFinalOrderWithSuccessfulTransactionId: `
    SELECT o.id AS orderId, o.status, o.successfulTransactionId
    FROM \`order\` o
    WHERE o.successfulTransactionId IS NOT NULL
      AND o.status NOT IN ('paid','sent','delivered')
    LIMIT 10;
  `,
  postFinalizationWrongOrder: `
    SELECT
      f.id AS finalizationId,
      f.orderId AS finalizationOrderId,
      f.transactionId,
      t.orderId AS transactionOrderId
    FROM order_payment_finalization f
    INNER JOIN transaction t ON t.id = f.transactionId
    WHERE f.orderId != t.orderId
    LIMIT 10;
  `,
  postMultipleActiveAttemptsPerOrder: `
    SELECT
      t.orderId,
      COUNT(*) AS activeAttemptCount,
      GROUP_CONCAT(t.id ORDER BY t.id) AS transactionIds,
      GROUP_CONCAT(t.status ORDER BY t.id) AS statuses
    FROM transaction t
    WHERE t.status IN ('pending', 'verification_started', 'verification_uncertain')
    GROUP BY t.orderId
    HAVING COUNT(*) > 1
    LIMIT 10;
  `,
};
