import { MigrationInterface, QueryRunner } from 'typeorm';

export class PhaseDiscountEngineFoundation1990000000001
  implements MigrationInterface
{
  name = 'PhaseDiscountEngineFoundation1990000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`product\`
        ADD COLUMN \`discountDisplayExpiresAt\` datetime NULL
    `);

    await queryRunner.query(`
      CREATE TABLE \`discount_discovery_pool\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`productId\` int NOT NULL,
        \`source\` varchar(32) NOT NULL DEFAULT 'trendyol',
        \`sourceProductId\` varchar(64) NOT NULL,
        \`categoryName\` varchar(128) NULL,
        \`listingDiscountPct\` decimal(8,2) NULL,
        \`verifiedDiscountPct\` decimal(8,2) NULL,
        \`flashTags\` varchar(255) NULL,
        \`campaignWindowEndsAt\` datetime NULL,
        \`displayExpiresAt\` datetime NULL,
        \`verifiedAt\` datetime NULL,
        \`status\` enum('active','expired','rejected') NOT NULL DEFAULT 'active',
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`uq_discount_pool_product\` (\`productId\`),
        INDEX \`idx_discount_pool_source_product\` (\`sourceProductId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`discount_discovery_pool\``);
    await queryRunner.query(`
      ALTER TABLE \`product\` DROP COLUMN \`discountDisplayExpiresAt\`
    `);
  }
}
