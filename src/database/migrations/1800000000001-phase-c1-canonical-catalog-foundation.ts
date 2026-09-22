import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PHASE C1 — Additive canonical catalog foundation.
 * Creates new tables only. Does NOT alter/delete existing category or product rows.
 */
export class phaseC1CanonicalCatalogFoundation1800000000001
  implements MigrationInterface
{
  name = 'phaseC1CanonicalCatalogFoundation1800000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`canonical_category\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`parentId\` int NULL,
        \`name\` varchar(255) NOT NULL,
        \`status\` enum('active','inactive') NOT NULL DEFAULT 'active',
        \`displayOrder\` int NOT NULL DEFAULT 1,
        \`imagePath\` varchar(255) NULL,
        \`audience\` varchar(64) NULL,
        \`isLocalPrototype\` tinyint(1) NOT NULL DEFAULT 0,
        \`createdAt\` datetime NOT NULL,
        \`updatedAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_canonical_category_parentId\` (\`parentId\`),
        INDEX \`idx_canonical_category_status_order\` (\`status\`, \`displayOrder\`),
        CONSTRAINT \`fk_canonical_category_parent\`
          FOREIGN KEY (\`parentId\`) REFERENCES \`canonical_category\`(\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`source_category_mapping\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`source\` varchar(128) NOT NULL,
        \`sourceCategoryId\` int NOT NULL,
        \`canonicalCategoryId\` int NOT NULL,
        \`status\` enum('active','inactive','draft') NOT NULL DEFAULT 'active',
        \`note\` varchar(255) NULL,
        \`createdAt\` datetime NOT NULL,
        \`updatedAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_source_category_mapping_identity\` (\`source\`, \`sourceCategoryId\`),
        INDEX \`idx_scm_canonicalCategoryId\` (\`canonicalCategoryId\`),
        INDEX \`idx_scm_sourceCategoryId\` (\`sourceCategoryId\`),
        CONSTRAINT \`fk_scm_source_category\`
          FOREIGN KEY (\`sourceCategoryId\`) REFERENCES \`category\`(\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT \`fk_scm_canonical_category\`
          FOREIGN KEY (\`canonicalCategoryId\`) REFERENCES \`canonical_category\`(\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`source_category_mapping\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`canonical_category\``);
  }
}
