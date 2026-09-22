import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addColumnIfMissing,
  addIndexIfMissing,
  addUniqueIndexIfMissing,
  columnExists,
  dropColumnIfExists,
  dropForeignKeyIfExists,
  dropIndexIfExists,
  foreignKeyExists,
  tableExists,
} from '../migration-utils';

/**
 * Phase C2A — Manual Order Payment (additive).
 * Receipt SUBMITTED/UNDER_REVIEW never marks Order paid.
 */
export class phaseC2aManualOrderPayment1910000000001
  implements MigrationInterface
{
  name = 'phaseC2aManualOrderPayment1910000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- setting: timing + launch gates ---
    await addColumnIfMissing(
      queryRunner,
      'setting',
      'manualPaymentSubmitDeadlineHours',
      '`manualPaymentSubmitDeadlineHours` INT NOT NULL DEFAULT 24 AFTER `tryToRialSource`',
    );
    await addColumnIfMissing(
      queryRunner,
      'setting',
      'manualPaymentReviewHoldHours',
      '`manualPaymentReviewHoldHours` INT NOT NULL DEFAULT 48 AFTER `manualPaymentSubmitDeadlineHours`',
    );
    await addColumnIfMissing(
      queryRunner,
      'setting',
      'manualPaymentResubmitGraceHours',
      '`manualPaymentResubmitGraceHours` INT NOT NULL DEFAULT 24 AFTER `manualPaymentReviewHoldHours`',
    );
    await addColumnIfMissing(
      queryRunner,
      'setting',
      'onlineGatewayPaymentsEnabled',
      '`onlineGatewayPaymentsEnabled` TINYINT(1) NOT NULL DEFAULT 0 AFTER `manualPaymentResubmitGraceHours`',
    );
    await addColumnIfMissing(
      queryRunner,
      'setting',
      'walletSpendEnabled',
      '`walletSpendEnabled` TINYINT(1) NOT NULL DEFAULT 0 AFTER `onlineGatewayPaymentsEnabled`',
    );

    // --- transaction: nullable gatewayId + manual payment links ---
    if (await tableExists(queryRunner, 'transaction')) {
      await dropForeignKeyIfExists(
        queryRunner,
        'transaction',
        'fk_transaction_gateway1',
      );

      if (await columnExists(queryRunner, 'transaction', 'gatewayId')) {
        await queryRunner.query(
          `ALTER TABLE \`transaction\` MODIFY COLUMN \`gatewayId\` INT NULL DEFAULT NULL`,
        );
      }

      if (
        !(await foreignKeyExists(
          queryRunner,
          'transaction',
          'fk_transaction_gateway1',
        ))
      ) {
        await queryRunner.query(`
          ALTER TABLE \`transaction\`
          ADD CONSTRAINT \`fk_transaction_gateway1\`
            FOREIGN KEY (\`gatewayId\`)
            REFERENCES \`gateway\` (\`id\`)
            ON DELETE NO ACTION
            ON UPDATE NO ACTION
        `);
      }

      await addColumnIfMissing(
        queryRunner,
        'transaction',
        'paymentSubmissionId',
        '`paymentSubmissionId` INT NULL DEFAULT NULL AFTER `paymentSource`',
      );
      await addColumnIfMissing(
        queryRunner,
        'transaction',
        'manualRail',
        "`manualRail` VARCHAR(32) NULL DEFAULT NULL AFTER `paymentSubmissionId`",
      );
      await addIndexIfMissing(
        queryRunner,
        'transaction',
        'idx_transaction_paymentSubmissionId',
        '`paymentSubmissionId`',
      );
    }

    // --- manual_payment_method ---
    if (!(await tableExists(queryRunner, 'manual_payment_method'))) {
      await queryRunner.query(`
        CREATE TABLE \`manual_payment_method\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`rail\` ENUM('CARD_TO_CARD','PAYA','POL','SATNA') NOT NULL,
          \`enabled\` TINYINT(1) NOT NULL DEFAULT 1,
          \`displayOrder\` INT NOT NULL DEFAULT 0,
          \`customerInstructions\` TEXT NULL,
          \`minAmountIrt\` DECIMAL(20,2) NULL DEFAULT NULL,
          \`maxAmountIrt\` DECIMAL(20,2) NULL DEFAULT NULL,
          \`createdAt\` DATETIME NOT NULL,
          \`updatedAt\` DATETIME NOT NULL,
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`uq_manual_payment_method_rail\` (\`rail\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }

    // Seed rails
    const seedNow = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const rails: Array<[string, number, number]> = [
      ['CARD_TO_CARD', 1, 1],
      ['PAYA', 1, 2],
      ['POL', 1, 3],
      ['SATNA', 1, 4],
    ];
    for (const [rail, enabled, displayOrder] of rails) {
      await queryRunner.query(
        `
          INSERT INTO \`manual_payment_method\`
            (\`rail\`, \`enabled\`, \`displayOrder\`, \`customerInstructions\`, \`createdAt\`, \`updatedAt\`)
          SELECT ?, ?, ?, NULL, ?, ?
          FROM DUAL
          WHERE NOT EXISTS (
            SELECT 1 FROM \`manual_payment_method\` WHERE \`rail\` = ?
          )
        `,
        [rail, enabled, displayOrder, seedNow, seedNow, rail],
      );
    }

    // --- bank_destination ---
    if (!(await tableExists(queryRunner, 'bank_destination'))) {
      await queryRunner.query(`
        CREATE TABLE \`bank_destination\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`bankName\` VARCHAR(128) NOT NULL,
          \`accountHolderName\` VARCHAR(255) NOT NULL,
          \`cardNumber\` VARCHAR(32) NULL DEFAULT NULL,
          \`iban\` VARCHAR(34) NULL DEFAULT NULL,
          \`accountNumber\` VARCHAR(64) NULL DEFAULT NULL,
          \`enabled\` TINYINT(1) NOT NULL DEFAULT 1,
          \`allowedRails\` JSON NOT NULL,
          \`displayOrder\` INT NOT NULL DEFAULT 0,
          \`instructions\` TEXT NULL,
          \`minAmountIrt\` DECIMAL(20,2) NULL DEFAULT NULL,
          \`maxAmountIrt\` DECIMAL(20,2) NULL DEFAULT NULL,
          \`createdAt\` DATETIME NOT NULL,
          \`createdBy\` INT NULL DEFAULT NULL,
          \`updatedAt\` DATETIME NOT NULL,
          \`updatedBy\` INT NULL DEFAULT NULL,
          PRIMARY KEY (\`id\`),
          INDEX \`idx_bank_destination_enabled_display\` (\`enabled\`, \`displayOrder\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }

    // --- private_receipt_object ---
    if (!(await tableExists(queryRunner, 'private_receipt_object'))) {
      await queryRunner.query(`
        CREATE TABLE \`private_receipt_object\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`objectKey\` VARCHAR(36) NOT NULL,
          \`storageKey\` VARCHAR(512) NOT NULL,
          \`originalFilename\` VARCHAR(255) NOT NULL,
          \`mimeType\` VARCHAR(128) NOT NULL,
          \`sizeBytes\` INT NOT NULL,
          \`sha256\` VARCHAR(64) NOT NULL,
          \`customerId\` INT NOT NULL,
          \`createdAt\` DATETIME NOT NULL,
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`uq_private_receipt_object_objectKey\` (\`objectKey\`),
          INDEX \`idx_private_receipt_object_customerId\` (\`customerId\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }

    // --- payment_submission ---
    if (!(await tableExists(queryRunner, 'payment_submission'))) {
      await queryRunner.query(`
        CREATE TABLE \`payment_submission\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`purpose\` ENUM('ORDER_PAYMENT') NOT NULL DEFAULT 'ORDER_PAYMENT',
          \`customerId\` INT NOT NULL,
          \`orderId\` INT NOT NULL,
          \`rail\` ENUM('CARD_TO_CARD','PAYA','POL','SATNA') NOT NULL,
          \`bankDestinationId\` INT NULL DEFAULT NULL,
          \`destinationBankName\` VARCHAR(128) NULL DEFAULT NULL,
          \`destinationAccountHolderName\` VARCHAR(255) NULL DEFAULT NULL,
          \`destinationCardNumber\` VARCHAR(32) NULL DEFAULT NULL,
          \`destinationIban\` VARCHAR(34) NULL DEFAULT NULL,
          \`destinationAccountNumber\` VARCHAR(64) NULL DEFAULT NULL,
          \`expectedAmount\` DECIMAL(20,2) NOT NULL,
          \`expectedCurrency\` ENUM('USD','TRY','IRT') NOT NULL DEFAULT 'IRT',
          \`status\` ENUM('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'SUBMITTED',
          \`activeEvidenceId\` INT NULL DEFAULT NULL,
          \`holdExpiresAt\` DATETIME NULL DEFAULT NULL,
          \`reviewedAt\` DATETIME NULL DEFAULT NULL,
          \`reviewedByUserId\` INT NULL DEFAULT NULL,
          \`rejectionReasonCode\` VARCHAR(64) NULL DEFAULT NULL,
          \`rejectionReasonText\` VARCHAR(512) NULL DEFAULT NULL,
          \`claimedAt\` DATETIME NULL DEFAULT NULL,
          \`claimedByUserId\` INT NULL DEFAULT NULL,
          \`amountMismatchOverrideReason\` VARCHAR(512) NULL DEFAULT NULL,
          \`transactionId\` INT NULL DEFAULT NULL,
          \`idempotencyKey\` VARCHAR(128) NOT NULL,
          \`activeLockKey\` VARCHAR(64) NULL DEFAULT NULL,
          \`createdAt\` DATETIME NOT NULL,
          \`updatedAt\` DATETIME NOT NULL,
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`uq_payment_submission_customer_order_idempotency\` (\`customerId\`, \`orderId\`, \`idempotencyKey\`),
          UNIQUE INDEX \`uq_payment_submission_activeLockKey\` (\`activeLockKey\`),
          INDEX \`idx_payment_submission_orderId\` (\`orderId\`),
          INDEX \`idx_payment_submission_status\` (\`status\`),
          INDEX \`idx_payment_submission_customerId\` (\`customerId\`),
          INDEX \`idx_payment_submission_holdExpiresAt\` (\`holdExpiresAt\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }

    // --- payment_evidence ---
    if (!(await tableExists(queryRunner, 'payment_evidence'))) {
      await queryRunner.query(`
        CREATE TABLE \`payment_evidence\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`submissionId\` INT NOT NULL,
          \`attemptNo\` INT NOT NULL,
          \`receiptObjectId\` INT NOT NULL,
          \`submittedAmount\` DECIMAL(20,2) NULL DEFAULT NULL,
          \`submittedCurrency\` ENUM('USD','TRY','IRT') NOT NULL DEFAULT 'IRT',
          \`bankReference\` VARCHAR(128) NULL DEFAULT NULL,
          \`bankReferenceNormalized\` VARCHAR(128) NULL DEFAULT NULL,
          \`payerName\` VARCHAR(255) NULL DEFAULT NULL,
          \`customerNote\` VARCHAR(512) NULL DEFAULT NULL,
          \`contentSha256\` VARCHAR(64) NULL DEFAULT NULL,
          \`submittedAt\` DATETIME NOT NULL,
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`uq_payment_evidence_submission_attempt\` (\`submissionId\`, \`attemptNo\`),
          INDEX \`idx_payment_evidence_bankRefNorm\` (\`bankReferenceNormalized\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }

    // --- payment_review_event ---
    if (!(await tableExists(queryRunner, 'payment_review_event'))) {
      await queryRunner.query(`
        CREATE TABLE \`payment_review_event\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`submissionId\` INT NOT NULL,
          \`actorUserId\` INT NULL DEFAULT NULL,
          \`actorCustomerId\` INT NULL DEFAULT NULL,
          \`action\` VARCHAR(64) NOT NULL,
          \`fromStatus\` VARCHAR(32) NULL DEFAULT NULL,
          \`toStatus\` VARCHAR(32) NULL DEFAULT NULL,
          \`reasonCode\` VARCHAR(64) NULL DEFAULT NULL,
          \`reasonText\` VARCHAR(512) NULL DEFAULT NULL,
          \`metadataJson\` JSON NULL,
          \`createdAt\` DATETIME NOT NULL,
          PRIMARY KEY (\`id\`),
          INDEX \`idx_payment_review_event_submissionId\` (\`submissionId\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }

    // --- user_capability ---
    if (!(await tableExists(queryRunner, 'user_capability'))) {
      await queryRunner.query(`
        CREATE TABLE \`user_capability\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`userId\` INT NOT NULL,
          \`capability\` VARCHAR(64) NOT NULL,
          \`createdAt\` DATETIME NOT NULL,
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`uq_user_capability_user_cap\` (\`userId\`, \`capability\`),
          INDEX \`idx_user_capability_userId\` (\`userId\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'user_capability',
      'payment_review_event',
      'payment_evidence',
      'payment_submission',
      'private_receipt_object',
      'bank_destination',
      'manual_payment_method',
    ]) {
      if (await tableExists(queryRunner, table)) {
        await queryRunner.query(`DROP TABLE \`${table}\``);
      }
    }

    await dropIndexIfExists(
      queryRunner,
      'transaction',
      'idx_transaction_paymentSubmissionId',
    );
    await dropColumnIfExists(queryRunner, 'transaction', 'manualRail');
    await dropColumnIfExists(queryRunner, 'transaction', 'paymentSubmissionId');

    // Restore NOT NULL gatewayId only if no nulls exist
    if (await columnExists(queryRunner, 'transaction', 'gatewayId')) {
      const nulls = await queryRunner.query(
        `SELECT COUNT(*) AS c FROM \`transaction\` WHERE \`gatewayId\` IS NULL`,
      );
      if (Number(nulls?.[0]?.c || 0) === 0) {
        await dropForeignKeyIfExists(
          queryRunner,
          'transaction',
          'fk_transaction_gateway1',
        );
        await queryRunner.query(
          `ALTER TABLE \`transaction\` MODIFY COLUMN \`gatewayId\` INT NOT NULL`,
        );
        await queryRunner.query(`
          ALTER TABLE \`transaction\`
          ADD CONSTRAINT \`fk_transaction_gateway1\`
            FOREIGN KEY (\`gatewayId\`)
            REFERENCES \`gateway\` (\`id\`)
            ON DELETE NO ACTION
            ON UPDATE NO ACTION
        `);
      }
    }

    for (const col of [
      'walletSpendEnabled',
      'onlineGatewayPaymentsEnabled',
      'manualPaymentResubmitGraceHours',
      'manualPaymentReviewHoldHours',
      'manualPaymentSubmitDeadlineHours',
    ]) {
      await dropColumnIfExists(queryRunner, 'setting', col);
    }
  }
}
