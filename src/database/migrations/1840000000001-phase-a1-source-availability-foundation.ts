import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addColumnIfMissing,
  addIndexIfMissing,
  dropColumnIfExists,
  dropIndexIfExists,
} from '../migration-utils';

/**
 * Phase A1 — Source-agnostic availability + freshness foundation.
 *
 * Additive only on `product`:
 * - commercial availability state (separate from sync health)
 * - sync/freshness state + attempt/success/error timestamps
 * - bounded error diagnostics
 * - indexes for future adaptive refresh / OOS recheck (scheduler not wired)
 *
 * Existing rows receive UNKNOWN + NEVER_VERIFIED via NOT NULL DEFAULT on ADD.
 * Does NOT classify stale hasStock/isSellable as confirmed UNAVAILABLE.
 * Does NOT change PLP/PDP/Cart/Checkout behavior.
 * Does NOT add unique (source, sourceId) — duplicates remain a carry-forward.
 *
 * Rollback: drops A1 indexes + columns only (safe; no catalog row deletes).
 */
export class phaseA1SourceAvailabilityFoundation1840000000001
  implements MigrationInterface
{
  name = 'phaseA1SourceAvailabilityFoundation1840000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // MySQL fills existing rows with the DEFAULT when adding NOT NULL columns.
    await addColumnIfMissing(
      queryRunner,
      'product',
      'sourceAvailability',
      "`sourceAvailability` enum('available','unavailable','unknown','removed') NOT NULL DEFAULT 'unknown'",
    );

    await addColumnIfMissing(
      queryRunner,
      'product',
      'sourceSyncStatus',
      "`sourceSyncStatus` enum('fresh','stale','source_error','never_verified') NOT NULL DEFAULT 'never_verified'",
    );

    await addColumnIfMissing(
      queryRunner,
      'product',
      'availabilityLastConfirmedAt',
      '`availabilityLastConfirmedAt` datetime NULL',
    );

    await addColumnIfMissing(
      queryRunner,
      'product',
      'sourceLastAttemptAt',
      '`sourceLastAttemptAt` datetime NULL',
    );

    await addColumnIfMissing(
      queryRunner,
      'product',
      'sourceLastSuccessAt',
      '`sourceLastSuccessAt` datetime NULL',
    );

    await addColumnIfMissing(
      queryRunner,
      'product',
      'sourceLastErrorAt',
      '`sourceLastErrorAt` datetime NULL',
    );

    await addColumnIfMissing(
      queryRunner,
      'product',
      'sourceSyncErrorCode',
      '`sourceSyncErrorCode` varchar(64) NULL',
    );

    await addColumnIfMissing(
      queryRunner,
      'product',
      'sourceSyncErrorDetail',
      '`sourceSyncErrorDetail` varchar(255) NULL',
    );

    // Future scheduler / discovery dimensions (no unique identity constraint).
    await addIndexIfMissing(
      queryRunner,
      'product',
      'idx_product_sourceAvailability',
      '`sourceAvailability`',
    );
    await addIndexIfMissing(
      queryRunner,
      'product',
      'idx_product_sourceSync_attempt',
      '`sourceSyncStatus`, `sourceLastAttemptAt`',
    );
    await addIndexIfMissing(
      queryRunner,
      'product',
      'idx_product_availability_confirmed',
      '`sourceAvailability`, `availabilityLastConfirmedAt`',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await dropIndexIfExists(
      queryRunner,
      'product',
      'idx_product_availability_confirmed',
    );
    await dropIndexIfExists(
      queryRunner,
      'product',
      'idx_product_sourceSync_attempt',
    );
    await dropIndexIfExists(
      queryRunner,
      'product',
      'idx_product_sourceAvailability',
    );

    await dropColumnIfExists(queryRunner, 'product', 'sourceSyncErrorDetail');
    await dropColumnIfExists(queryRunner, 'product', 'sourceSyncErrorCode');
    await dropColumnIfExists(queryRunner, 'product', 'sourceLastErrorAt');
    await dropColumnIfExists(queryRunner, 'product', 'sourceLastSuccessAt');
    await dropColumnIfExists(queryRunner, 'product', 'sourceLastAttemptAt');
    await dropColumnIfExists(
      queryRunner,
      'product',
      'availabilityLastConfirmedAt',
    );
    await dropColumnIfExists(queryRunner, 'product', 'sourceSyncStatus');
    await dropColumnIfExists(queryRunner, 'product', 'sourceAvailability');
  }
}
