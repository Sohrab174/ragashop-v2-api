import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addColumnIfMissing,
  columnExists,
  tableExists,
} from '../migration-utils';

/**
 * A5 Fix Pass #2 — checkpoint revision (ABA protection) + scopeKey capacity.
 * Additive only. Safe if prior checkpoint migration already applied.
 *
 * scopeKey: "source:" (7) + max source name (64) = 71 → store as 96 with headroom.
 */
export class phaseA5CatalogRefreshCheckpointRevision1890000000001
  implements MigrationInterface
{
  name = 'phaseA5CatalogRefreshCheckpointRevision1890000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'catalog_refresh_checkpoint'))) {
      // Prior migration missing — create full current shape.
      await queryRunner.query(`
        CREATE TABLE \`catalog_refresh_checkpoint\` (
          \`scopeKey\` varchar(96) NOT NULL,
          \`afterProductId\` bigint NOT NULL DEFAULT 0,
          \`revision\` bigint NOT NULL DEFAULT 0,
          \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
          PRIMARY KEY (\`scopeKey\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      return;
    }

    await addColumnIfMissing(
      queryRunner,
      'catalog_refresh_checkpoint',
      'revision',
      '`revision` bigint NOT NULL DEFAULT 0',
    );

    // Existing rows get a safe non-zero generation token so first CAS after
    // upgrade can proceed from a known revision baseline.
    await queryRunner.query(`
      UPDATE \`catalog_refresh_checkpoint\`
      SET \`revision\` = 1
      WHERE \`revision\` = 0 OR \`revision\` IS NULL
    `);

    // Widen scopeKey for "source:" + 64-char source (+ headroom).
    const col = await queryRunner.query(
      `SHOW COLUMNS FROM \`catalog_refresh_checkpoint\` LIKE 'scopeKey'`,
    );
    const type = String(col?.[0]?.Type || '').toLowerCase();
    if (!type.includes('varchar(96)') && !type.includes('varchar(128)')) {
      await queryRunner.query(`
        ALTER TABLE \`catalog_refresh_checkpoint\`
        MODIFY \`scopeKey\` varchar(96) NOT NULL
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'catalog_refresh_checkpoint'))) {
      return;
    }
    if (await columnExists(queryRunner, 'catalog_refresh_checkpoint', 'revision')) {
      await queryRunner.query(
        `ALTER TABLE \`catalog_refresh_checkpoint\` DROP COLUMN \`revision\``,
      );
    }
    await queryRunner.query(`
      ALTER TABLE \`catalog_refresh_checkpoint\`
      MODIFY \`scopeKey\` varchar(64) NOT NULL
    `);
  }
}
