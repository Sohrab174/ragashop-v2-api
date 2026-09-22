import { MigrationInterface, QueryRunner } from 'typeorm';
import { indexExists, tableExists } from '../migration-utils';

export class phase1cMarketplaceProductImportIdentity1789000000002
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await tableExists(queryRunner, 'marketplace_product_import_identity')) {
      return;
    }

    await queryRunner.query(`
      CREATE TABLE \`marketplace_product_import_identity\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`source\` VARCHAR(64) NOT NULL,
        \`sourceProductId\` VARCHAR(128) NOT NULL,
        \`identityKey\` VARCHAR(191) NOT NULL,
        \`status\` ENUM('creating', 'succeeded', 'failed') NOT NULL DEFAULT 'creating',
        \`ownerToken\` VARCHAR(64) NULL DEFAULT NULL,
        \`leaseExpiresAt\` DATETIME NULL DEFAULT NULL,
        \`productId\` INT NULL DEFAULT NULL,
        \`errorCode\` VARCHAR(64) NULL DEFAULT NULL,
        \`createdAt\` DATETIME NOT NULL,
        \`updatedAt\` DATETIME NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_mpii_identityKey\` (\`identityKey\`),
        INDEX \`idx_mpii_status_lease\` (\`status\`, \`leaseExpiresAt\`),
        INDEX \`idx_mpii_source_product\` (\`source\`, \`sourceProductId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (
      !(await tableExists(queryRunner, 'marketplace_product_import_identity'))
    ) {
      return;
    }

    if (
      await indexExists(
        queryRunner,
        'marketplace_product_import_identity',
        'uq_mpii_identityKey',
      )
    ) {
      await queryRunner.query(
        `ALTER TABLE \`marketplace_product_import_identity\` DROP INDEX \`uq_mpii_identityKey\``,
      );
    }

    await queryRunner.query(
      `DROP TABLE \`marketplace_product_import_identity\``,
    );
  }
}
