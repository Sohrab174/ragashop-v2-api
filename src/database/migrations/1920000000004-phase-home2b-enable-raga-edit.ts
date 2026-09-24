import { MigrationInterface, QueryRunner } from 'typeorm';
import { tableExists } from '../migration-utils';

/**
 * HOME-2B — enable RagaShop Edit (editorial_promo) as a scheduled curated chapter.
 * Data-only: enable + customer title. productIds remain Admin-managed JSON.
 * Does not invent product ids — keeps existing preferredProductId in configJson.
 */
export class phaseHome2bEnableRagaEdit1920000000004
  implements MigrationInterface
{
  name = 'phaseHome2bEnableRagaEdit1920000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'storefront_home_section'))) return;

    await queryRunner.query(
      `
      UPDATE \`storefront_home_section\`
      SET \`enabled\` = 1,
          \`title\` = COALESCE(NULLIF(TRIM(\`title\`), ''), 'منتخب RagaShop'),
          \`subtitle\` = COALESCE(
            NULLIF(TRIM(\`subtitle\`), ''),
            'انتخاب‌های برنامه‌ریزی‌شده برای فصل و مناسبت‌های پیش رو'
          ),
          \`displayOrder\` = 35,
          \`updatedAt\` = NOW()
      WHERE \`sectionKey\` = 'editorial_promo'
      `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'storefront_home_section'))) return;

    await queryRunner.query(
      `
      UPDATE \`storefront_home_section\`
      SET \`enabled\` = 0,
          \`updatedAt\` = NOW()
      WHERE \`sectionKey\` = 'editorial_promo'
      `,
    );
  }
}
