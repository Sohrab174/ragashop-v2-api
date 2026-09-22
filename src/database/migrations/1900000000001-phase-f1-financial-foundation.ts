import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addColumnIfMissing,
  addIndexIfMissing,
  addUniqueIndexIfMissing,
  columnExists,
  dropColumnIfExists,
  dropIndexIfExists,
  tableExists,
} from '../migration-utils';

/**
 * Phase F1 — Financial Data Foundation (additive only).
 * No fabricated backfill of FX/COGS for legacy rows.
 */
export class phaseF1FinancialFoundation1900000000001
  implements MigrationInterface
{
  name = 'phaseF1FinancialFoundation1900000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- setting: TGJU fetch metadata ---
    await addColumnIfMissing(
      queryRunner,
      'setting',
      'tryToRialFetchedAt',
      '`tryToRialFetchedAt` DATETIME NULL DEFAULT NULL AFTER `changePercentTryToRial`',
    );
    await addColumnIfMissing(
      queryRunner,
      'setting',
      'tryToRialSource',
      "`tryToRialSource` VARCHAR(32) NULL DEFAULT 'TGJU' AFTER `tryToRialFetchedAt`",
    );

    // --- product cost ---
    for (const col of [
      [
        'purchaseCost',
        '`purchaseCost` DECIMAL(20,2) NULL DEFAULT NULL AFTER `discountPercent`',
      ],
      [
        'landedUnitCost',
        '`landedUnitCost` DECIMAL(20,2) NULL DEFAULT NULL AFTER `purchaseCost`',
      ],
      [
        'costCurrency',
        "`costCurrency` ENUM('USD','TRY','IRT') NULL DEFAULT NULL AFTER `landedUnitCost`",
      ],
      [
        'costSource',
        "`costSource` ENUM('manual_admin','import_manual','calculated','unknown_legacy') NULL DEFAULT NULL AFTER `costCurrency`",
      ],
      [
        'costUpdatedAt',
        '`costUpdatedAt` DATETIME NULL DEFAULT NULL AFTER `costSource`',
      ],
      [
        'costUpdatedByUserId',
        '`costUpdatedByUserId` INT NULL DEFAULT NULL AFTER `costUpdatedAt`',
      ],
    ] as const) {
      await addColumnIfMissing(queryRunner, 'product', col[0], col[1]);
    }

    // --- PAV cost ---
    for (const col of [
      [
        'purchaseCost',
        '`purchaseCost` DECIMAL(20,2) NULL DEFAULT NULL AFTER `discountPercent`',
      ],
      [
        'landedUnitCost',
        '`landedUnitCost` DECIMAL(20,2) NULL DEFAULT NULL AFTER `purchaseCost`',
      ],
      [
        'costCurrency',
        "`costCurrency` ENUM('USD','TRY','IRT') NULL DEFAULT NULL AFTER `landedUnitCost`",
      ],
      [
        'costSource',
        "`costSource` ENUM('manual_admin','import_manual','calculated','unknown_legacy') NULL DEFAULT NULL AFTER `costCurrency`",
      ],
      [
        'costUpdatedAt',
        '`costUpdatedAt` DATETIME NULL DEFAULT NULL AFTER `costSource`',
      ],
      [
        'costUpdatedByUserId',
        '`costUpdatedByUserId` INT NULL DEFAULT NULL AFTER `costUpdatedAt`',
      ],
    ] as const) {
      await addColumnIfMissing(
        queryRunner,
        'product_attribute_value',
        col[0],
        col[1],
      );
    }

    // --- order FX + financial status ---
    await addColumnIfMissing(
      queryRunner,
      'order',
      'commercialCurrency',
      "`commercialCurrency` ENUM('USD','TRY','IRT') NULL DEFAULT NULL AFTER `finalAmount`",
    );
    await addColumnIfMissing(
      queryRunner,
      'order',
      'fxRateToIrt',
      '`fxRateToIrt` DECIMAL(20,6) NULL DEFAULT NULL AFTER `commercialCurrency`',
    );
    await addColumnIfMissing(
      queryRunner,
      'order',
      'fxCapturedAt',
      '`fxCapturedAt` DATETIME NULL DEFAULT NULL AFTER `fxRateToIrt`',
    );
    await addColumnIfMissing(
      queryRunner,
      'order',
      'fxRateSource',
      "`fxRateSource` VARCHAR(32) NULL DEFAULT NULL AFTER `fxCapturedAt`",
    );
    await addColumnIfMissing(
      queryRunner,
      'order',
      'financialConfirmedAt',
      '`financialConfirmedAt` DATETIME NULL DEFAULT NULL AFTER `fxRateSource`',
    );
    await addColumnIfMissing(
      queryRunner,
      'order',
      'profitabilityStatus',
      "`profitabilityStatus` ENUM('complete','incomplete_missing_cogs','legacy_incomplete') NULL DEFAULT NULL AFTER `financialConfirmedAt`",
    );
    await addColumnIfMissing(
      queryRunner,
      'order',
      'shippingCostActual',
      '`shippingCostActual` DECIMAL(20,2) NULL DEFAULT NULL AFTER `profitabilityStatus`',
    );
    await addIndexIfMissing(
      queryRunner,
      'order',
      'idx_order_financialConfirmedAt',
      '`financialConfirmedAt`',
    );
    await addIndexIfMissing(
      queryRunner,
      'order',
      'idx_order_profitabilityStatus',
      '`profitabilityStatus`',
    );

    // Mark existing rows as legacy_incomplete (no invented FX/COGS).
    if (await columnExists(queryRunner, 'order', 'profitabilityStatus')) {
      await queryRunner.query(`
        UPDATE \`order\`
        SET \`profitabilityStatus\` = 'legacy_incomplete'
        WHERE \`profitabilityStatus\` IS NULL
      `);
    }

    // --- order_item cost snapshots ---
    await addColumnIfMissing(
      queryRunner,
      'order_item',
      'unitPurchaseCostSnapshot',
      '`unitPurchaseCostSnapshot` DECIMAL(20,2) NULL DEFAULT NULL AFTER `finalAmount`',
    );
    await addColumnIfMissing(
      queryRunner,
      'order_item',
      'unitLandedCostSnapshot',
      '`unitLandedCostSnapshot` DECIMAL(20,2) NULL DEFAULT NULL AFTER `unitPurchaseCostSnapshot`',
    );
    await addColumnIfMissing(
      queryRunner,
      'order_item',
      'costCurrency',
      "`costCurrency` ENUM('USD','TRY','IRT') NULL DEFAULT NULL AFTER `unitLandedCostSnapshot`",
    );
    await addColumnIfMissing(
      queryRunner,
      'order_item',
      'cogsStatus',
      "`cogsStatus` ENUM('captured','missing','legacy_unknown') NULL DEFAULT NULL AFTER `costCurrency`",
    );
    await addColumnIfMissing(
      queryRunner,
      'order_item',
      'costSource',
      "`costSource` ENUM('manual_admin','import_manual','calculated','unknown_legacy') NULL DEFAULT NULL AFTER `cogsStatus`",
    );

    // --- transaction settlement ---
    await addColumnIfMissing(
      queryRunner,
      'transaction',
      'settlementCurrency',
      "`settlementCurrency` ENUM('USD','TRY','IRT') NULL DEFAULT NULL AFTER `amount`",
    );
    await addColumnIfMissing(
      queryRunner,
      'transaction',
      'fxRateToIrt',
      '`fxRateToIrt` DECIMAL(20,6) NULL DEFAULT NULL AFTER `settlementCurrency`',
    );
    await addColumnIfMissing(
      queryRunner,
      'transaction',
      'commercialAmount',
      '`commercialAmount` DECIMAL(20,2) NULL DEFAULT NULL AFTER `fxRateToIrt`',
    );
    await addColumnIfMissing(
      queryRunner,
      'transaction',
      'commercialCurrency',
      "`commercialCurrency` ENUM('USD','TRY','IRT') NULL DEFAULT NULL AFTER `commercialAmount`",
    );
    await addColumnIfMissing(
      queryRunner,
      'transaction',
      'paymentFeeAmount',
      '`paymentFeeAmount` DECIMAL(20,2) NULL DEFAULT NULL AFTER `commercialCurrency`',
    );
    await addColumnIfMissing(
      queryRunner,
      'transaction',
      'paymentFeeCurrency',
      "`paymentFeeCurrency` ENUM('USD','TRY','IRT') NULL DEFAULT NULL AFTER `paymentFeeAmount`",
    );

    // --- financial_event ---
    if (!(await tableExists(queryRunner, 'financial_event'))) {
      await queryRunner.query(`
        CREATE TABLE \`financial_event\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`eventType\` VARCHAR(64) NOT NULL,
          \`amount\` DECIMAL(20,2) NOT NULL,
          \`currency\` ENUM('USD','TRY','IRT') NOT NULL,
          \`amountIrt\` DECIMAL(20,2) NULL DEFAULT NULL,
          \`fxRateToIrt\` DECIMAL(20,6) NULL DEFAULT NULL,
          \`orderId\` INT NULL DEFAULT NULL,
          \`orderItemId\` INT NULL DEFAULT NULL,
          \`transactionId\` INT NULL DEFAULT NULL,
          \`customerId\` INT NULL DEFAULT NULL,
          \`referralAwardId\` INT NULL DEFAULT NULL,
          \`sourceType\` VARCHAR(32) NOT NULL,
          \`sourceId\` VARCHAR(64) NOT NULL,
          \`idempotencyKey\` VARCHAR(128) NOT NULL,
          \`reversalOfEventId\` INT NULL DEFAULT NULL,
          \`metadata\` JSON NULL,
          \`occurredAt\` DATETIME NOT NULL,
          \`createdAt\` DATETIME NOT NULL,
          \`actorType\` ENUM('system','admin_user','customer','employee') NOT NULL DEFAULT 'system',
          \`actorId\` INT NULL DEFAULT NULL,
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`uq_financial_event_idempotencyKey\` (\`idempotencyKey\` ASC),
          INDEX \`idx_financial_event_orderId\` (\`orderId\` ASC),
          INDEX \`idx_financial_event_eventType\` (\`eventType\` ASC),
          INDEX \`idx_financial_event_occurredAt\` (\`occurredAt\` ASC)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await tableExists(queryRunner, 'financial_event')) {
      await queryRunner.query(`DROP TABLE \`financial_event\``);
    }

    for (const col of [
      'paymentFeeCurrency',
      'paymentFeeAmount',
      'commercialCurrency',
      'commercialAmount',
      'fxRateToIrt',
      'settlementCurrency',
    ]) {
      await dropColumnIfExists(queryRunner, 'transaction', col);
    }

    for (const col of [
      'costSource',
      'cogsStatus',
      'costCurrency',
      'unitLandedCostSnapshot',
      'unitPurchaseCostSnapshot',
    ]) {
      await dropColumnIfExists(queryRunner, 'order_item', col);
    }

    await dropIndexIfExists(
      queryRunner,
      'order',
      'idx_order_profitabilityStatus',
    );
    await dropIndexIfExists(
      queryRunner,
      'order',
      'idx_order_financialConfirmedAt',
    );
    for (const col of [
      'shippingCostActual',
      'profitabilityStatus',
      'financialConfirmedAt',
      'fxRateSource',
      'fxCapturedAt',
      'fxRateToIrt',
      'commercialCurrency',
    ]) {
      await dropColumnIfExists(queryRunner, 'order', col);
    }

    for (const col of [
      'costUpdatedByUserId',
      'costUpdatedAt',
      'costSource',
      'costCurrency',
      'landedUnitCost',
      'purchaseCost',
    ]) {
      await dropColumnIfExists(queryRunner, 'product_attribute_value', col);
      await dropColumnIfExists(queryRunner, 'product', col);
    }

    await dropColumnIfExists(queryRunner, 'setting', 'tryToRialSource');
    await dropColumnIfExists(queryRunner, 'setting', 'tryToRialFetchedAt');
  }
}
