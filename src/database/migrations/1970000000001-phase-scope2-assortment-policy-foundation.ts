import { MigrationInterface, QueryRunner } from 'typeorm';
import { tableExists } from '../migration-utils';

/**
 * SCOPE-2 — Central assortment policy foundation (additive, shadow only).
 *
 * Creates:
 * - assortment_policy_rule
 * - assortment_policy_audit
 * - category_assortment_resolution
 * - assortment_policy_state
 *
 * Does NOT alter category, product, mapping, order, or canonical tables.
 * Does NOT seed rules or resolutions (seed/recompute scripts handle that).
 * Does NOT change storefront / crawler / AUTO-MAP behavior.
 */
export class phaseScope2AssortmentPolicyFoundation1970000000001
  implements MigrationInterface
{
  name = 'phaseScope2AssortmentPolicyFoundation1970000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'assortment_policy_rule'))) {
      await queryRunner.query(`
        CREATE TABLE \`assortment_policy_rule\` (
          \`id\` int NOT NULL AUTO_INCREMENT,
          \`provider\` varchar(128) NULL,
          \`matchType\` enum('path_prefix','category') NOT NULL,
          \`pathPrefixNorm\` varchar(512) NULL,
          \`categoryId\` int NULL,
          \`selectorKey\` varchar(640) NOT NULL,
          \`status\` enum('IN_SCOPE','OUT_OF_SCOPE','REVIEW_REQUIRED') NOT NULL,
          \`reasonCode\` varchar(64) NOT NULL,
          \`businessDomain\` varchar(64) NULL,
          \`note\` varchar(512) NULL,
          \`isActive\` tinyint(1) NOT NULL DEFAULT 1,
          \`createdBy\` varchar(128) NULL,
          \`createdAt\` datetime NOT NULL,
          \`updatedBy\` varchar(128) NULL,
          \`updatedAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`uq_apr_selectorKey\` (\`selectorKey\`),
          INDEX \`idx_apr_active_match\` (\`isActive\`, \`matchType\`),
          INDEX \`idx_apr_provider_path\` (\`provider\`, \`pathPrefixNorm\`),
          INDEX \`idx_apr_categoryId\` (\`categoryId\`),
          CONSTRAINT \`fk_apr_category\`
            FOREIGN KEY (\`categoryId\`) REFERENCES \`category\`(\`id\`)
            ON DELETE NO ACTION ON UPDATE NO ACTION
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }

    if (!(await tableExists(queryRunner, 'assortment_policy_audit'))) {
      await queryRunner.query(`
        CREATE TABLE \`assortment_policy_audit\` (
          \`id\` bigint NOT NULL AUTO_INCREMENT,
          \`operation\` varchar(64) NOT NULL,
          \`ruleId\` int NULL,
          \`actor\` varchar(128) NULL,
          \`beforeJson\` json NULL,
          \`afterJson\` json NULL,
          \`policyVersion\` int NULL,
          \`createdAt\` datetime NOT NULL,
          PRIMARY KEY (\`id\`),
          INDEX \`idx_apa_ruleId_createdAt\` (\`ruleId\`, \`createdAt\`),
          INDEX \`idx_apa_createdAt\` (\`createdAt\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }

    if (!(await tableExists(queryRunner, 'category_assortment_resolution'))) {
      await queryRunner.query(`
        CREATE TABLE \`category_assortment_resolution\` (
          \`categoryId\` int NOT NULL,
          \`status\` enum('IN_SCOPE','OUT_OF_SCOPE','REVIEW_REQUIRED') NOT NULL,
          \`reasonCode\` varchar(64) NOT NULL,
          \`ruleId\` int NULL,
          \`via\` varchar(32) NOT NULL,
          \`businessDomain\` varchar(64) NULL,
          \`policyVersion\` int NOT NULL,
          \`resolvedAt\` datetime NOT NULL,
          PRIMARY KEY (\`categoryId\`),
          INDEX \`idx_car_status\` (\`status\`),
          INDEX \`idx_car_policyVersion\` (\`policyVersion\`),
          INDEX \`idx_car_ruleId\` (\`ruleId\`),
          CONSTRAINT \`fk_car_category\`
            FOREIGN KEY (\`categoryId\`) REFERENCES \`category\`(\`id\`)
            ON DELETE NO ACTION ON UPDATE NO ACTION,
          CONSTRAINT \`fk_car_rule\`
            FOREIGN KEY (\`ruleId\`) REFERENCES \`assortment_policy_rule\`(\`id\`)
            ON DELETE NO ACTION ON UPDATE NO ACTION
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }

    if (!(await tableExists(queryRunner, 'assortment_policy_state'))) {
      await queryRunner.query(`
        CREATE TABLE \`assortment_policy_state\` (
          \`id\` int NOT NULL,
          \`policyVersion\` int NOT NULL DEFAULT 0,
          \`updatedAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await queryRunner.query(`
        INSERT INTO \`assortment_policy_state\` (\`id\`, \`policyVersion\`, \`updatedAt\`)
        VALUES (1, 0, NOW())
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS \`category_assortment_resolution\``,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS \`assortment_policy_audit\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`assortment_policy_rule\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`assortment_policy_state\``);
  }
}
