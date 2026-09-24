import { MigrationInterface, QueryRunner } from 'typeorm';
import { tableExists } from '../migration-utils';

/**
 * COMMERCE UI V2 — default Home composition reset.
 * Campaign → Categories → New → Secondary campaign → Chapters → Sale → Link CTA
 * Featured Brands + Guide journeys off by default (Admin can re-enable).
 */
export class phaseCommerceUiV2HomeComposition1920000000007
  implements MigrationInterface
{
  name = 'phaseCommerceUiV2HomeComposition1920000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'storefront_home_section'))) return;

    const updates: Array<{
      key: string;
      enabled: 0 | 1;
      order: number;
    }> = [
      { key: 'link_shopping', enabled: 0, order: 5 },
      { key: 'campaign', enabled: 1, order: 10 },
      { key: 'categories', enabled: 1, order: 15 },
      { key: 'newest', enabled: 1, order: 20 },
      { key: 'editorial_promo', enabled: 1, order: 25 },
      { key: 'category_spotlight', enabled: 0, order: 28 },
      { key: 'featured_brands', enabled: 0, order: 30 },
      { key: 'category_chapters', enabled: 1, order: 35 },
      { key: 'discounts', enabled: 1, order: 40 },
      { key: 'paste_link', enabled: 0, order: 45 },
      { key: 'quick_guide', enabled: 1, order: 50 },
    ];

    for (const row of updates) {
      await queryRunner.query(
        `
        UPDATE \`storefront_home_section\`
        SET \`enabled\` = ?,
            \`displayOrder\` = ?,
            \`updatedAt\` = NOW()
        WHERE \`sectionKey\` = ?
        `,
        [row.enabled, row.order, row.key],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'storefront_home_section'))) return;

    const rollback: Array<{
      key: string;
      enabled: 0 | 1;
      order: number;
    }> = [
      { key: 'link_shopping', enabled: 0, order: 5 },
      { key: 'campaign', enabled: 1, order: 10 },
      { key: 'quick_guide', enabled: 1, order: 15 },
      { key: 'categories', enabled: 1, order: 20 },
      { key: 'featured_brands', enabled: 1, order: 22 },
      { key: 'paste_link', enabled: 1, order: 25 },
      { key: 'newest', enabled: 1, order: 30 },
      { key: 'editorial_promo', enabled: 1, order: 35 },
      { key: 'category_spotlight', enabled: 0, order: 36 },
      { key: 'discounts', enabled: 1, order: 40 },
      { key: 'category_chapters', enabled: 1, order: 45 },
    ];

    for (const row of rollback) {
      await queryRunner.query(
        `
        UPDATE \`storefront_home_section\`
        SET \`enabled\` = ?,
            \`displayOrder\` = ?,
            \`updatedAt\` = NOW()
        WHERE \`sectionKey\` = ?
        `,
        [row.enabled, row.order, row.key],
      );
    }
  }
}
