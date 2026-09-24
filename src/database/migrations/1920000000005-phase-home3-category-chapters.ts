import { MigrationInterface, QueryRunner } from 'typeorm';
import { tableExists } from '../migration-utils';

/**
 * HOME-3 — seed reusable category_chapters section + demote redundant
 * Home link-shopping strips (Universal Search owns that messaging).
 * Chapters array stays Admin-managed JSON; empty chapters → storefront
 * may auto-compose from landing roots with real catalog products.
 */
export class phaseHome3CategoryChapters1920000000005
  implements MigrationInterface
{
  name = 'phaseHome3CategoryChapters1920000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'storefront_home_section'))) return;

    await queryRunner.query(
      `
      INSERT INTO \`storefront_home_section\`
        (\`sectionKey\`, \`enabled\`, \`displayOrder\`, \`title\`, \`subtitle\`, \`configJson\`, \`startAt\`, \`endAt\`, \`createdAt\`, \`updatedAt\`)
      SELECT
        'category_chapters',
        1,
        45,
        'دنیای دسته‌ها',
        NULL,
        '{"limit":6,"chapters":[]}',
        NULL,
        NULL,
        NOW(),
        NOW()
      FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM \`storefront_home_section\` WHERE \`sectionKey\` = 'category_chapters'
      )
      `,
    );

    await queryRunner.query(
      `
      UPDATE \`storefront_home_section\`
      SET \`enabled\` = 0, \`updatedAt\` = NOW()
      WHERE \`sectionKey\` IN ('quick_guide', 'paste_link')
      `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'storefront_home_section'))) return;

    await queryRunner.query(
      `
      DELETE FROM \`storefront_home_section\`
      WHERE \`sectionKey\` = 'category_chapters'
      `,
    );

    await queryRunner.query(
      `
      UPDATE \`storefront_home_section\`
      SET \`enabled\` = 1, \`updatedAt\` = NOW()
      WHERE \`sectionKey\` IN ('quick_guide', 'paste_link')
      `,
    );
  }
}
