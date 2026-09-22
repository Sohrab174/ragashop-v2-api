import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addColumnIfMissing,
  addIndexIfMissing,
  dropColumnIfExists,
  dropIndexIfExists,
} from '../migration-utils';

/**
 * Phase A3 — Managed external catalog lifecycle foundation.
 * Additive only:
 * - product.catalogOrigin (+ indexes)
 * - marketplace_import_job.priority (+ claim-friendly index)
 *
 * Backfill: sourced products → external_curated; others → native_marketplace.
 * Does NOT crawl, enqueue, or change discovery behavior.
 */
export class phaseA3CatalogLifecycleFoundation1850000000001
  implements MigrationInterface
{
  name = 'phaseA3CatalogLifecycleFoundation1850000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await addColumnIfMissing(
      queryRunner,
      'product',
      'catalogOrigin',
      "`catalogOrigin` enum('external_curated','external_on_demand','native_marketplace') NOT NULL DEFAULT 'native_marketplace'",
    );

    await queryRunner.query(`
      UPDATE \`product\`
      SET \`catalogOrigin\` = 'external_curated'
      WHERE \`source\` IS NOT NULL AND \`source\` <> ''
        AND \`catalogOrigin\` = 'native_marketplace'
    `);

    await addIndexIfMissing(
      queryRunner,
      'product',
      'idx_product_catalogOrigin',
      '`catalogOrigin`',
    );
    await addIndexIfMissing(
      queryRunner,
      'product',
      'idx_product_catalog_refresh_select',
      '`catalogOrigin`, `sourceAvailability`, `sourceSyncStatus`, `id`',
    );

    await addColumnIfMissing(
      queryRunner,
      'marketplace_import_job',
      'priority',
      '`priority` int NOT NULL DEFAULT 0',
    );

    // Customer imports created before A3 keep 0; raise existing customer queued jobs.
    await queryRunner.query(`
      UPDATE \`marketplace_import_job\`
      SET \`priority\` = 100
      WHERE \`requestType\` = 'customer'
        AND \`priority\` = 0
        AND \`status\` IN ('queued', 'processing', 'retry_wait')
    `);

    await addIndexIfMissing(
      queryRunner,
      'marketplace_import_job',
      'idx_mij_claim_priority',
      '`status`, `priority`, `nextAttemptAt`, `createdAt`',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await dropIndexIfExists(
      queryRunner,
      'marketplace_import_job',
      'idx_mij_claim_priority',
    );
    await dropColumnIfExists(queryRunner, 'marketplace_import_job', 'priority');

    await dropIndexIfExists(
      queryRunner,
      'product',
      'idx_product_catalog_refresh_select',
    );
    await dropIndexIfExists(
      queryRunner,
      'product',
      'idx_product_catalogOrigin',
    );
    await dropColumnIfExists(queryRunner, 'product', 'catalogOrigin');
  }
}
