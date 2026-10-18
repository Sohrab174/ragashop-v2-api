import { MigrationInterface, QueryRunner } from 'typeorm';
import { tableExists } from '../migration-utils';

/**
 * Pass 3 — additive instance table for repeatable homepage sections.
 * Does not read, update, or delete storefront_home_section.
 * An empty instance table means the published homepage still uses singleton rows.
 */
export class phaseHomeSectionInstances1920000000010
  implements MigrationInterface
{
  name = 'phaseHomeSectionInstances1920000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await tableExists(queryRunner, 'storefront_home_section_instance')) {
      return;
    }
    await queryRunner.query(`
      CREATE TABLE \`storefront_home_section_instance\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`instanceKey\` VARCHAR(64) NOT NULL,
        \`sectionType\` VARCHAR(32) NOT NULL,
        \`enabled\` TINYINT(1) NOT NULL DEFAULT 1,
        \`displayOrder\` INT NOT NULL DEFAULT 100,
        \`title\` VARCHAR(128) NULL,
        \`subtitle\` VARCHAR(255) NULL,
        \`configJson\` MEDIUMTEXT NULL,
        \`createdAt\` DATETIME NOT NULL,
        \`updatedAt\` DATETIME NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_home_section_instance_key\` (\`instanceKey\`),
        KEY \`idx_home_section_instance_order\` (\`displayOrder\`, \`enabled\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await tableExists(queryRunner, 'storefront_home_section_instance')) {
      await queryRunner.query(
        'DROP TABLE `storefront_home_section_instance`',
      );
    }
  }
}
