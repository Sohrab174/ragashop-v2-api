import { MigrationInterface, QueryRunner } from 'typeorm';
import { tableExists } from '../migration-utils';

/**
 * HOME-2A — default Home first-view order:
 * campaign/hero before quick_guide (demote onboarding below commerce).
 * Idempotent: only adjusts the known HOME-1 seed order (displayOrder=8).
 */
export class phaseHome2aDemoteQuickGuide1920000000002
  implements MigrationInterface
{
  name = 'phaseHome2aDemoteQuickGuide1920000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'storefront_home_section'))) return;

    await queryRunner.query(
      `
      UPDATE \`storefront_home_section\`
      SET \`displayOrder\` = 45,
          \`updatedAt\` = NOW()
      WHERE \`sectionKey\` = 'quick_guide'
        AND \`displayOrder\` < 20
      `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'storefront_home_section'))) return;

    await queryRunner.query(
      `
      UPDATE \`storefront_home_section\`
      SET \`displayOrder\` = 8,
          \`updatedAt\` = NOW()
      WHERE \`sectionKey\` = 'quick_guide'
        AND \`displayOrder\` = 45
      `,
    );
  }
}
