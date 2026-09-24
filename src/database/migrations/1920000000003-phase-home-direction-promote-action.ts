import { MigrationInterface, QueryRunner } from 'typeorm';
import { tableExists } from '../migration-utils';

/**
 * Design-direction correction — restore Action/Discovery between Hero and categories.
 * Data-only: displayOrder for quick_guide. No schema change.
 * Idempotent: only when still at the HOME-2A demoted order (45).
 */
export class phaseHomeDirectionPromoteAction1920000000003
  implements MigrationInterface
{
  name = 'phaseHomeDirectionPromoteAction1920000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'storefront_home_section'))) return;

    await queryRunner.query(
      `
      UPDATE \`storefront_home_section\`
      SET \`displayOrder\` = 15,
          \`updatedAt\` = NOW()
      WHERE \`sectionKey\` = 'quick_guide'
        AND \`displayOrder\` = 45
      `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'storefront_home_section'))) return;

    await queryRunner.query(
      `
      UPDATE \`storefront_home_section\`
      SET \`displayOrder\` = 45,
          \`updatedAt\` = NOW()
      WHERE \`sectionKey\` = 'quick_guide'
        AND \`displayOrder\` = 15
      `,
    );
  }
}
