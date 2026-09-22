import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addIndexIfMissing,
  dropIndexIfExists,
  tableExists,
} from '../migration-utils';
import { BRAND_ALIAS_DEFAULTS } from '../../modules/search/brand-alias.defaults';
import { normalizeSearchText } from '../../modules/search/search-normalize';

/**
 * Search Engine V1 — brand_alias table + seed aliases + product name index aid.
 * Non-destructive / additive only.
 */
export class searchEngineV1BrandAlias1870000000001
  implements MigrationInterface
{
  name = 'searchEngineV1BrandAlias1870000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'brand_alias'))) {
      await queryRunner.query(`
        CREATE TABLE \`brand_alias\` (
          \`id\` int NOT NULL AUTO_INCREMENT,
          \`brandId\` int NOT NULL,
          \`alias\` varchar(128) NOT NULL,
          \`normalizedAlias\` varchar(128) NOT NULL,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uq_brand_alias_normalized\` (\`normalizedAlias\`),
          KEY \`idx_brand_alias_brandId\` (\`brandId\`),
          CONSTRAINT \`fk_brand_alias_brand\`
            FOREIGN KEY (\`brandId\`) REFERENCES \`brand\` (\`id\`)
            ON DELETE CASCADE ON UPDATE NO ACTION
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }

    await addIndexIfMissing(
      queryRunner,
      'product',
      'idx_product_name_prefix',
      '`name`(64)',
    );

    // Seed default bilingual aliases by resolving brand rows (no hardcoded ids).
    for (const group of BRAND_ALIAS_DEFAULTS) {
      const matchers = group.brandMatchers.map((m) => normalizeSearchText(m));
      const brands: Array<{ id: number }> = await queryRunner.query(
        `
          SELECT \`id\` FROM \`brand\`
          WHERE LOWER(REPLACE(REPLACE(\`sourceName\`, 'ي', 'ی'), 'ك', 'ک')) IN (${matchers
            .map(() => '?')
            .join(',')})
             OR LOWER(REPLACE(REPLACE(\`name\`, 'ي', 'ی'), 'ك', 'ک')) IN (${matchers
               .map(() => '?')
               .join(',')})
          ORDER BY \`id\` ASC
          LIMIT 1
        `,
        [...matchers, ...matchers],
      );
      const brandId = brands[0]?.id;
      if (!brandId) continue;

      for (const alias of group.aliases) {
        const normalizedAlias = normalizeSearchText(alias);
        if (!normalizedAlias) continue;
        await queryRunner.query(
          `
            INSERT IGNORE INTO \`brand_alias\` (\`brandId\`, \`alias\`, \`normalizedAlias\`)
            VALUES (?, ?, ?)
          `,
          [brandId, alias, normalizedAlias],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await dropIndexIfExists(queryRunner, 'product', 'idx_product_name_prefix');
    if (await tableExists(queryRunner, 'brand_alias')) {
      await queryRunner.query(`DROP TABLE \`brand_alias\``);
    }
  }
}
