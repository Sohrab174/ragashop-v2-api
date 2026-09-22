import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addColumnIfMissing,
  addIndexIfMissing,
  dropColumnIfExists,
  dropIndexIfExists,
} from '../migration-utils';

/**
 * A3 Fix Pass #1 — split supply ownership vs curated membership.
 * Additive: keeps deprecated catalogOrigin column (staged deprecation).
 */
export class phaseA3Fix1SupplyCuratedSplit1860000000001
  implements MigrationInterface
{
  name = 'phaseA3Fix1SupplyCuratedSplit1860000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await addColumnIfMissing(
      queryRunner,
      'product',
      'supplyType',
      "`supplyType` enum('external_source','native_marketplace','unclassified') NOT NULL DEFAULT 'unclassified'",
    );

    await addColumnIfMissing(
      queryRunner,
      'product',
      'isCuratedExternalCatalog',
      '`isCuratedExternalCatalog` tinyint(1) NOT NULL DEFAULT 0',
    );

    // Preserve curated discovery for previously backfilled sourced catalog.
    await queryRunner.query(`
      UPDATE \`product\`
      SET
        \`supplyType\` = 'external_source',
        \`isCuratedExternalCatalog\` = 1
      WHERE \`source\` IS NOT NULL AND \`source\` <> ''
    `);

    // source-null rows: ambiguous test/legacy — not proven marketplace sellers.
    await queryRunner.query(`
      UPDATE \`product\`
      SET
        \`supplyType\` = 'unclassified',
        \`isCuratedExternalCatalog\` = 0
      WHERE \`source\` IS NULL OR \`source\` = ''
    `);

    // If any row was marked external_on_demand in catalogOrigin without source (shouldn't), keep unclassified.
    await queryRunner.query(`
      UPDATE \`product\`
      SET \`isCuratedExternalCatalog\` = 0
      WHERE \`catalogOrigin\` = 'external_on_demand'
        AND (\`source\` IS NULL OR \`source\` = '')
    `);

    await addIndexIfMissing(
      queryRunner,
      'product',
      'idx_product_supplyType',
      '`supplyType`',
    );
    await addIndexIfMissing(
      queryRunner,
      'product',
      'idx_product_curated_external',
      '`supplyType`, `isCuratedExternalCatalog`, `id`',
    );
    await addIndexIfMissing(
      queryRunner,
      'product',
      'idx_product_curated_refresh_select',
      '`supplyType`, `isCuratedExternalCatalog`, `sourceAvailability`, `sourceSyncStatus`, `id`',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await dropIndexIfExists(
      queryRunner,
      'product',
      'idx_product_curated_refresh_select',
    );
    await dropIndexIfExists(
      queryRunner,
      'product',
      'idx_product_curated_external',
    );
    await dropIndexIfExists(queryRunner, 'product', 'idx_product_supplyType');
    await dropColumnIfExists(queryRunner, 'product', 'isCuratedExternalCatalog');
    await dropColumnIfExists(queryRunner, 'product', 'supplyType');
  }
}
