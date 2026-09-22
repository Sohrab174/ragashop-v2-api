import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addColumnIfMissing,
  columnExists,
  dropColumnIfExists,
  dropForeignKeyIfExists,
  foreignKeyExists,
  tableExists,
} from '../migration-utils';
import {
  PREFLIGHT_SQL,
  detectCountConflict,
  detectFinalizationOrderOwnershipMismatch,
  detectFinalizationProviderPaidSuperseded,
  detectFinalizationTransactionNotSuccessful,
  detectMultipleActiveAttemptsPerOrder,
  detectNonFinalOrderWithSuccessfulTransactionId,
  detectPaidOrderWithoutPaidTransaction,
  detectPaidTransactionOnNonFinalOrder,
  detectPostconditionViolations,
  detectSuccessfulTransactionIdFinalizationMismatch,
  detectSuccessfulTransactionIdProviderPaidSuperseded,
  detectSuccessfulTransactionIdWrongOrder,
  formatMigrationBlockedError,
} from '../phase1a-migration-preflight';

async function assertNoIncompatibleTransactionStatuses(
  queryRunner: QueryRunner,
  context: string,
): Promise<void> {
  const rows = await queryRunner.query(`
    SELECT status, COUNT(*) AS cnt
    FROM transaction
    WHERE status IN (
      'verification_started',
      'verification_uncertain',
      'superseded',
      'provider_paid_superseded'
    )
    GROUP BY status;
  `);

  if (rows?.length) {
    throw new Error(
      `${context}: incompatible transaction status rows exist: ${rows
        .map((r: any) => `${r.status}(${r.cnt})`)
        .join(', ')}. Reconcile before down migration.`,
    );
  }
}

export class phase1aFixPass31788000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.runPaymentConflictPreflight(queryRunner);

    await queryRunner.query(`
      ALTER TABLE \`transaction\`
      MODIFY COLUMN \`status\` ENUM(
        'pending',
        'verification_started',
        'verification_uncertain',
        'paid',
        'failed',
        'superseded',
        'provider_paid_superseded'
      ) NOT NULL DEFAULT 'pending';
    `);

    await addColumnIfMissing(
      queryRunner,
      'transaction',
      'gatewaySessionStartedAt',
      '`gatewaySessionStartedAt` DATETIME NULL DEFAULT NULL AFTER `providerVerificationReference`',
    );

    await addColumnIfMissing(
      queryRunner,
      'transaction',
      'gatewaySessionLeaseToken',
      '`gatewaySessionLeaseToken` VARCHAR(64) NULL DEFAULT NULL AFTER `gatewaySessionStartedAt`',
    );

    await addColumnIfMissing(
      queryRunner,
      'transaction',
      'gatewaySessionLeaseExpiresAt',
      '`gatewaySessionLeaseExpiresAt` DATETIME NULL DEFAULT NULL AFTER `gatewaySessionLeaseToken`',
    );

    await addColumnIfMissing(
      queryRunner,
      'transaction',
      'paymentSource',
      "`paymentSource` ENUM('gateway','wallet','manual') NULL DEFAULT NULL AFTER `gatewaySessionLeaseExpiresAt`",
    );

    await addColumnIfMissing(
      queryRunner,
      'transaction',
      'reconciliationWinningTransactionId',
      '`reconciliationWinningTransactionId` INT NULL DEFAULT NULL AFTER `paymentSource`',
    );

    await addColumnIfMissing(
      queryRunner,
      'transaction',
      'reconciliationReason',
      '`reconciliationReason` VARCHAR(255) NULL DEFAULT NULL AFTER `reconciliationWinningTransactionId`',
    );

    await addColumnIfMissing(
      queryRunner,
      'transaction',
      'reconciliationDetectedAt',
      '`reconciliationDetectedAt` DATETIME NULL DEFAULT NULL AFTER `reconciliationReason`',
    );

    await this.backfillPaymentFinalization(queryRunner);
    await this.runPaymentPostconditions(queryRunner);

    if (
      (await columnExists(queryRunner, 'order', 'successfulTransactionId')) &&
      !(await foreignKeyExists(
        queryRunner,
        'order',
        'fk_order_successful_transaction',
      ))
    ) {
      await queryRunner.query(`
        ALTER TABLE \`order\`
        ADD CONSTRAINT \`fk_order_successful_transaction\`
          FOREIGN KEY (\`successfulTransactionId\`)
          REFERENCES \`transaction\` (\`id\`)
          ON DELETE NO ACTION
          ON UPDATE NO ACTION;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await assertNoIncompatibleTransactionStatuses(
      queryRunner,
      'PHASE1A_FIX_PASS3_DOWN_BLOCKED',
    );

    await dropForeignKeyIfExists(
      queryRunner,
      'order',
      'fk_order_successful_transaction',
    );

    await dropColumnIfExists(
      queryRunner,
      'transaction',
      'reconciliationDetectedAt',
    );
    await dropColumnIfExists(
      queryRunner,
      'transaction',
      'reconciliationReason',
    );
    await dropColumnIfExists(
      queryRunner,
      'transaction',
      'reconciliationWinningTransactionId',
    );
    await dropColumnIfExists(queryRunner, 'transaction', 'paymentSource');
    await dropColumnIfExists(
      queryRunner,
      'transaction',
      'gatewaySessionLeaseExpiresAt',
    );
    await dropColumnIfExists(
      queryRunner,
      'transaction',
      'gatewaySessionLeaseToken',
    );
    await dropColumnIfExists(
      queryRunner,
      'transaction',
      'gatewaySessionStartedAt',
    );

    await queryRunner.query(`
      ALTER TABLE \`transaction\`
      MODIFY COLUMN \`status\` ENUM(
        'pending',
        'verification_started',
        'verification_uncertain',
        'paid',
        'failed',
        'superseded'
      ) NOT NULL DEFAULT 'pending';
    `);
  }

  private async runPaymentConflictPreflight(
    queryRunner: QueryRunner,
  ): Promise<void> {
    if (!(await tableExists(queryRunner, 'order_payment_finalization'))) {
      throw new Error(
        'PHASE1A_FIX_PASS3_MIGRATION_BLOCKED: order_payment_finalization table missing. Run pass2 migration first.',
      );
    }

    const checks: Array<{
      run: () => Promise<any[]>;
      detect: (rows: any[]) => ReturnType<typeof detectCountConflict>;
    }> = [
      {
        run: () => queryRunner.query(PREFLIGHT_SQL.multiplePaidPerOrder),
        detect: (rows) =>
          detectCountConflict(
            'multiple_paid_transactions_per_order',
            'Multiple paid transactions exist for one order',
            rows,
          ),
      },
      {
        run: () =>
          queryRunner.query(PREFLIGHT_SQL.multipleActiveAttemptsPerOrder),
        detect: detectMultipleActiveAttemptsPerOrder,
      },
      {
        run: () =>
          queryRunner.query(PREFLIGHT_SQL.paidOrderWithoutPaidTransaction),
        detect: detectPaidOrderWithoutPaidTransaction,
      },
      {
        run: () =>
          queryRunner.query(PREFLIGHT_SQL.paidTransactionOnNonFinalOrder),
        detect: detectPaidTransactionOnNonFinalOrder,
      },
      {
        run: () =>
          queryRunner.query(PREFLIGHT_SQL.finalizationOrderOwnershipMismatch),
        detect: detectFinalizationOrderOwnershipMismatch,
      },
      {
        run: () =>
          queryRunner.query(PREFLIGHT_SQL.finalizationTransactionNotSuccessful),
        detect: detectFinalizationTransactionNotSuccessful,
      },
      {
        run: () =>
          queryRunner.query(PREFLIGHT_SQL.finalizationProviderPaidSuperseded),
        detect: detectFinalizationProviderPaidSuperseded,
      },
      {
        run: () =>
          queryRunner.query(
            PREFLIGHT_SQL.successfulTransactionIdProviderPaidSuperseded,
          ),
        detect: detectSuccessfulTransactionIdProviderPaidSuperseded,
      },
      {
        run: () =>
          queryRunner.query(
            PREFLIGHT_SQL.nonFinalOrderWithSuccessfulTransactionId,
          ),
        detect: detectNonFinalOrderWithSuccessfulTransactionId,
      },
      {
        run: () =>
          queryRunner.query(
            PREFLIGHT_SQL.successfulTransactionIdFinalizationMismatch,
          ),
        detect: detectSuccessfulTransactionIdFinalizationMismatch,
      },
      {
        run: () =>
          queryRunner.query(PREFLIGHT_SQL.successfulTransactionIdWrongOrder),
        detect: detectSuccessfulTransactionIdWrongOrder,
      },
    ];

    for (const check of checks) {
      const rows = await check.run();
      const conflict = check.detect(rows);
      if (conflict) {
        throw new Error(formatMigrationBlockedError('PREFLIGHT', conflict));
      }
    }
  }

  private async backfillPaymentFinalization(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const candidates: Array<{
      orderId: number;
      transactionId: number;
      paidAt: Date | null;
    }> = await queryRunner.query(`
      SELECT o.id AS orderId, t.id AS transactionId, t.paidAt
      FROM \`order\` o
      INNER JOIN transaction t ON t.orderId = o.id AND t.status = 'paid'
      WHERE o.status IN ('paid', 'sent', 'delivered')
      ORDER BY o.id ASC, COALESCE(t.paidAt, t.createdAt) ASC, t.id ASC;
    `);

    const chosenByOrder = new Map<number, number>();

    for (const row of candidates || []) {
      if (!chosenByOrder.has(row.orderId)) {
        chosenByOrder.set(row.orderId, row.transactionId);
      }
    }

    for (const [orderId, transactionId] of chosenByOrder.entries()) {
      const existing = await queryRunner.query(
        `SELECT id, transactionId FROM order_payment_finalization WHERE orderId = ? LIMIT 1`,
        [orderId],
      );

      if (existing?.length) {
        if (+existing[0].transactionId !== +transactionId) {
          throw new Error(
            `PHASE1A_FIX_PASS3_BACKFILL_BLOCKED: order ${orderId} finalization row points to transaction ${existing[0].transactionId}, expected ${transactionId}`,
          );
        }
      } else {
        await queryRunner.query(
          `INSERT INTO order_payment_finalization (orderId, transactionId, finalizedAt)
           VALUES (?, ?, COALESCE((SELECT paidAt FROM transaction WHERE id = ?), NOW()))`,
          [orderId, transactionId, transactionId],
        );
      }

      await queryRunner.query(
        `UPDATE \`order\` SET successfulTransactionId = ? WHERE id = ?`,
        [transactionId, orderId],
      );

      await queryRunner.query(
        `UPDATE transaction SET paymentSource = COALESCE(paymentSource, 'gateway')
         WHERE id = ?`,
        [transactionId],
      );
    }

    const walletPaidWithoutSource = await queryRunner.query(`
      SELECT id FROM transaction
      WHERE status = 'paid' AND amount = 0 AND walletAmount > 0 AND paymentSource IS NULL
      LIMIT 1;
    `);

    if (walletPaidWithoutSource?.length) {
      await queryRunner.query(`
        UPDATE transaction SET paymentSource = 'wallet'
        WHERE status = 'paid' AND amount = 0 AND walletAmount > 0 AND paymentSource IS NULL;
      `);
    }
  }

  private async runPaymentPostconditions(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const coverageRows = await queryRunner.query(
      PREFLIGHT_SQL.postFinalizedOrderViolations,
    );
    const coverageConflicts = detectPostconditionViolations(coverageRows || []);
    if (coverageConflicts.length) {
      throw new Error(
        formatMigrationBlockedError('POSTCONDITION', coverageConflicts[0]),
      );
    }

    const postChecks: Array<{
      run: () => Promise<any[]>;
      detect: (rows: any[]) => ReturnType<typeof detectCountConflict>;
    }> = [
      {
        run: () => queryRunner.query(PREFLIGHT_SQL.multiplePaidPerOrder),
        detect: (rows) =>
          detectCountConflict(
            'postcondition_multiple_paid_transactions_per_order',
            'Multiple paid transactions exist for one order',
            rows,
          ),
      },
      {
        run: () =>
          queryRunner.query(PREFLIGHT_SQL.paidOrderWithoutPaidTransaction),
        detect: detectPaidOrderWithoutPaidTransaction,
      },
      {
        run: () =>
          queryRunner.query(
            PREFLIGHT_SQL.successfulTransactionIdFinalizationMismatch,
          ),
        detect: detectSuccessfulTransactionIdFinalizationMismatch,
      },
      {
        run: () =>
          queryRunner.query(PREFLIGHT_SQL.successfulTransactionIdWrongOrder),
        detect: detectSuccessfulTransactionIdWrongOrder,
      },
      {
        run: () =>
          queryRunner.query(PREFLIGHT_SQL.finalizationTransactionNotSuccessful),
        detect: detectFinalizationTransactionNotSuccessful,
      },
      {
        run: () =>
          queryRunner.query(PREFLIGHT_SQL.finalizationProviderPaidSuperseded),
        detect: detectFinalizationProviderPaidSuperseded,
      },
      {
        run: () =>
          queryRunner.query(
            PREFLIGHT_SQL.successfulTransactionIdProviderPaidSuperseded,
          ),
        detect: detectSuccessfulTransactionIdProviderPaidSuperseded,
      },
      {
        run: () =>
          queryRunner.query(
            PREFLIGHT_SQL.postNonFinalOrderWithSuccessfulTransactionId,
          ),
        detect: detectNonFinalOrderWithSuccessfulTransactionId,
      },
      {
        run: () => queryRunner.query(PREFLIGHT_SQL.postFinalizationWrongOrder),
        detect: detectFinalizationOrderOwnershipMismatch,
      },
      {
        run: () =>
          queryRunner.query(PREFLIGHT_SQL.postMultipleActiveAttemptsPerOrder),
        detect: detectMultipleActiveAttemptsPerOrder,
      },
    ];

    for (const check of postChecks) {
      const rows = await check.run();
      const conflict = check.detect(rows);
      if (conflict) {
        throw new Error(formatMigrationBlockedError('POSTCONDITION', conflict));
      }
    }
  }
}
