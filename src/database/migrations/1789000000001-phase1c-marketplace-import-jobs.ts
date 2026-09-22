import { MigrationInterface, QueryRunner } from 'typeorm';
import { indexExists, tableExists } from '../migration-utils';

export class phase1cMarketplaceImportJobs1789000000001
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await tableExists(queryRunner, 'marketplace_import_job')) {
      return;
    }

    await queryRunner.query(`
      CREATE TABLE \`marketplace_import_job\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`source\` VARCHAR(64) NOT NULL,
        \`sourceProductId\` VARCHAR(128) NOT NULL,
        \`canonicalSourceUrl\` VARCHAR(512) NOT NULL,
        \`requestType\` ENUM('customer', 'admin', 'scheduled') NOT NULL DEFAULT 'customer',
        \`status\` ENUM('queued', 'processing', 'retry_wait', 'succeeded', 'failed') NOT NULL DEFAULT 'queued',
        \`attemptCount\` INT NOT NULL DEFAULT 0,
        \`maxAttempts\` INT NOT NULL DEFAULT 3,
        \`nextAttemptAt\` DATETIME NULL DEFAULT NULL,
        \`claimedAt\` DATETIME NULL DEFAULT NULL,
        \`claimExpiresAt\` DATETIME NULL DEFAULT NULL,
        \`claimToken\` VARCHAR(64) NULL DEFAULT NULL,
        \`activeDedupKey\` VARCHAR(191) NULL DEFAULT NULL,
        \`startedAt\` DATETIME NULL DEFAULT NULL,
        \`completedAt\` DATETIME NULL DEFAULT NULL,
        \`failedAt\` DATETIME NULL DEFAULT NULL,
        \`productId\` INT NULL DEFAULT NULL,
        \`errorCode\` VARCHAR(64) NULL DEFAULT NULL,
        \`errorMessage\` VARCHAR(500) NULL DEFAULT NULL,
        \`requesterIpHash\` VARCHAR(64) NULL DEFAULT NULL,
        \`publicAccessToken\` VARCHAR(64) NOT NULL,
        \`requestCorrelationId\` VARCHAR(64) NULL DEFAULT NULL,
        \`createdAt\` DATETIME NOT NULL,
        \`updatedAt\` DATETIME NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_mij_activeDedupKey\` (\`activeDedupKey\`),
        UNIQUE INDEX \`uq_mij_publicAccessToken\` (\`publicAccessToken\`),
        INDEX \`idx_mij_status_nextAttempt\` (\`status\`, \`nextAttemptAt\`),
        INDEX \`idx_mij_claimExpires\` (\`claimExpiresAt\`),
        INDEX \`idx_mij_source_product\` (\`source\`, \`sourceProductId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'marketplace_import_job'))) {
      return;
    }

    if (
      await indexExists(
        queryRunner,
        'marketplace_import_job',
        'uq_mij_activeDedupKey',
      )
    ) {
      await queryRunner.query(
        `ALTER TABLE \`marketplace_import_job\` DROP INDEX \`uq_mij_activeDedupKey\``,
      );
    }

    await queryRunner.query(`DROP TABLE \`marketplace_import_job\``);
  }
}
