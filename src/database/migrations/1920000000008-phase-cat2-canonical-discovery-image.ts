import { MigrationInterface, QueryRunner } from 'typeorm';
import { tableExists, columnExists } from '../migration-utils';

/**
 * CAT-2 — additive discovery image on canonical categories.
 * Precedence at read-time: discoveryImagePath → imagePath → enriched fallback.
 */
export class phaseCat2CanonicalDiscoveryImage1920000000008
  implements MigrationInterface
{
  name = 'phaseCat2CanonicalDiscoveryImage1920000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'canonical_category'))) return;
    if (await columnExists(queryRunner, 'canonical_category', 'discoveryImagePath')) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE \`canonical_category\`
      ADD COLUMN \`discoveryImagePath\` varchar(255) NULL
      AFTER \`imagePath\`
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'canonical_category'))) return;
    if (!(await columnExists(queryRunner, 'canonical_category', 'discoveryImagePath'))) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE \`canonical_category\`
      DROP COLUMN \`discoveryImagePath\`
    `);
  }
}
