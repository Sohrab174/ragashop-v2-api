import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addColumnIfMissing,
  addUniqueIndexIfMissing,
  columnExists,
  dropColumnIfExists,
  dropForeignKeyIfExists,
  dropIndexIfExists,
  tableExists,
} from '../migration-utils';

export class phase1aFixPass21788000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'order_payment_finalization'))) {
      await queryRunner.query(`
        CREATE TABLE \`order_payment_finalization\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`orderId\` INT NOT NULL,
          \`transactionId\` INT NOT NULL,
          \`finalizedAt\` DATETIME NOT NULL,
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`uq_order_payment_finalization_orderId\` (\`orderId\` ASC),
          INDEX \`fk_order_payment_finalization_transaction_idx\` (\`transactionId\` ASC),
          CONSTRAINT \`fk_order_payment_finalization_order\`
            FOREIGN KEY (\`orderId\`) REFERENCES \`order\` (\`id\`)
            ON DELETE NO ACTION ON UPDATE NO ACTION,
          CONSTRAINT \`fk_order_payment_finalization_transaction\`
            FOREIGN KEY (\`transactionId\`) REFERENCES \`transaction\` (\`id\`)
            ON DELETE NO ACTION ON UPDATE NO ACTION
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }

    const duplicatePaidOrders: Array<{ orderId: number; cnt: string }> =
      await queryRunner.query(`
        SELECT orderId, COUNT(*) AS cnt
        FROM transaction
        WHERE status = 'paid'
        GROUP BY orderId
        HAVING COUNT(*) > 1
        LIMIT 5;
      `);

    if (duplicatePaidOrders?.length) {
      throw new Error(
        `PHASE1A_FIX_PASS2_MIGRATION_BLOCKED: multiple paid transactions exist for order(s): ${duplicatePaidOrders
          .map((r) => `${r.orderId}(${r.cnt})`)
          .join(
            ', ',
          )}. Reconcile LOCAL data before applying order-level payment finalization.`,
      );
    }

    const paidOrdersWithoutFinalization = await queryRunner.query(`
      SELECT o.id AS orderId, t.id AS transactionId
      FROM \`order\` o
      INNER JOIN transaction t ON t.orderId = o.id AND t.status = 'paid'
      WHERE o.status IN ('paid', 'sent', 'delivered')
      LIMIT 500;
    `);

    for (const row of paidOrdersWithoutFinalization || []) {
      await queryRunner.query(
        `INSERT IGNORE INTO order_payment_finalization (orderId, transactionId, finalizedAt)
         VALUES (?, ?, NOW())`,
        [row.orderId, row.transactionId],
      );
    }

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

    await addColumnIfMissing(
      queryRunner,
      'transaction',
      'gatewaySessionStatus',
      "`gatewaySessionStatus` ENUM('not_started','creating','ready','uncertain') NOT NULL DEFAULT 'not_started' AFTER `gatewayRedirectUrl`",
    );

    await addColumnIfMissing(
      queryRunner,
      'transaction',
      'verificationStartedAt',
      '`verificationStartedAt` DATETIME NULL DEFAULT NULL AFTER `gatewaySessionStatus`',
    );

    await addColumnIfMissing(
      queryRunner,
      'transaction',
      'providerVerificationReference',
      '`providerVerificationReference` VARCHAR(128) NULL DEFAULT NULL AFTER `verificationStartedAt`',
    );

    if (
      !(await columnExists(queryRunner, 'order', 'successfulTransactionId'))
    ) {
      await queryRunner.query(`
        ALTER TABLE \`order\`
        ADD COLUMN \`successfulTransactionId\` INT NULL DEFAULT NULL AFTER \`customerId\`,
        ADD INDEX \`fk_order_successful_transaction_idx\` (\`successfulTransactionId\` ASC);
      `);
    }

    const duplicateNumbers = await queryRunner.query(`
      SELECT number, COUNT(*) AS cnt
      FROM \`order\`
      GROUP BY number
      HAVING COUNT(*) > 1
      LIMIT 1;
    `);

    if (duplicateNumbers?.length) {
      throw new Error(
        `PHASE1A_FIX_PASS2_MIGRATION_BLOCKED: duplicate order.number values exist (example: ${duplicateNumbers[0].number}). Resolve LOCAL duplicates before adding uq_order_number.`,
      );
    }

    await addUniqueIndexIfMissing(
      queryRunner,
      'order',
      'uq_order_number',
      '`number` ASC',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const incompatible = await queryRunner.query(`
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

    if (incompatible?.length) {
      throw new Error(
        `PHASE1A_FIX_PASS2_DOWN_BLOCKED: reconcile transaction statuses before down migration: ${JSON.stringify(
          incompatible,
        )}`,
      );
    }

    await dropForeignKeyIfExists(
      queryRunner,
      'order',
      'fk_order_successful_transaction',
    );

    await dropColumnIfExists(queryRunner, 'order', 'successfulTransactionId');
    await dropColumnIfExists(
      queryRunner,
      'transaction',
      'providerVerificationReference',
    );
    await dropColumnIfExists(
      queryRunner,
      'transaction',
      'verificationStartedAt',
    );
    await dropColumnIfExists(
      queryRunner,
      'transaction',
      'gatewaySessionStatus',
    );

    await queryRunner.query(`
      ALTER TABLE \`transaction\`
      MODIFY COLUMN \`status\` ENUM('pending', 'paid', 'failed') NOT NULL DEFAULT 'pending';
    `);

    if (await tableExists(queryRunner, 'order_payment_finalization')) {
      await queryRunner.query(`DROP TABLE \`order_payment_finalization\`;`);
    }

    await dropIndexIfExists(queryRunner, 'order', 'uq_order_number');
  }
}
