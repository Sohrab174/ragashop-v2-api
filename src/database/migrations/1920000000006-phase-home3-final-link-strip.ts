import { MigrationInterface, QueryRunner } from 'typeorm';
import { tableExists } from '../migration-utils';

/**
 * HOME-3 final — restore compact Link Shopping strip (quick_guide) after Hero.
 * paste_link remains demoted; Universal Search stays the input surface.
 */
export class phaseHome3FinalLinkStrip1920000000006
  implements MigrationInterface
{
  name = 'phaseHome3FinalLinkStrip1920000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'storefront_home_section'))) return;

    await queryRunner.query(
      `
      UPDATE \`storefront_home_section\`
      SET \`enabled\` = 1,
          \`displayOrder\` = 15,
          \`updatedAt\` = NOW()
      WHERE \`sectionKey\` = 'quick_guide'
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
      WHERE \`sectionKey\` = 'quick_guide'
      `,
    );
  }
}
