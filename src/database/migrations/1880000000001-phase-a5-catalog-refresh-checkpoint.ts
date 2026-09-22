import { MigrationInterface, QueryRunner } from 'typeorm';
import { tableExists } from '../migration-utils';

/**
 * A5 Fix #1 — persisted catalog refresh keyset checkpoint.
 * Additive only. Enables fair cross-cycle progression without loading
 * the full curated catalog into memory.
 */
export class phaseA5CatalogRefreshCheckpoint1880000000001
  implements MigrationInterface
{
  name = 'phaseA5CatalogRefreshCheckpoint1880000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await tableExists(queryRunner, 'catalog_refresh_checkpoint')) {
      return;
    }
    await queryRunner.query(`
      CREATE TABLE \`catalog_refresh_checkpoint\` (
        \`scopeKey\` varchar(64) NOT NULL,
        \`afterProductId\` bigint NOT NULL DEFAULT 0,
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`scopeKey\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await tableExists(queryRunner, 'catalog_refresh_checkpoint')) {
      await queryRunner.query(`DROP TABLE \`catalog_refresh_checkpoint\``);
    }
  }
}
