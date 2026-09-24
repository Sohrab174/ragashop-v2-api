import { MigrationInterface, QueryRunner } from 'typeorm';
import { tableExists } from '../migration-utils';

/**
 * HOME-5A — final Home composition under Admin authority:
 * Hero → Site intro stories (paste_link) → New → Featured Brands →
 * Picks → Chapters → Sale → Link CTA
 *
 * Top کاوش دسته‌ها (categories) demoted; stories + brands re-enabled.
 * Does not invent catalog data — only toggles presentation sections.
 */
export class phaseHome5aFinalComposition1920000000009
  implements MigrationInterface
{
  name = 'phaseHome5aFinalComposition1920000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'storefront_home_section'))) return;

    const updates: Array<{
      key: string;
      enabled: 0 | 1;
      order: number;
      title?: string | null;
    }> = [
      { key: 'link_shopping', enabled: 0, order: 5 },
      { key: 'campaign', enabled: 1, order: 10 },
      { key: 'paste_link', enabled: 1, order: 14, title: 'شروع خرید' },
      { key: 'categories', enabled: 0, order: 15 },
      { key: 'newest', enabled: 1, order: 20 },
      { key: 'featured_brands', enabled: 1, order: 22, title: 'برندهای منتخب' },
      { key: 'editorial_promo', enabled: 1, order: 25 },
      { key: 'category_spotlight', enabled: 0, order: 28 },
      { key: 'category_chapters', enabled: 1, order: 35 },
      { key: 'discounts', enabled: 1, order: 40 },
      { key: 'quick_guide', enabled: 1, order: 50 },
    ];

    for (const row of updates) {
      if (row.title !== undefined) {
        await queryRunner.query(
          `
          UPDATE \`storefront_home_section\`
          SET \`enabled\` = ?,
              \`displayOrder\` = ?,
              \`title\` = ?,
              \`updatedAt\` = NOW()
          WHERE \`sectionKey\` = ?
          `,
          [row.enabled, row.order, row.title, row.key],
        );
      } else {
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'storefront_home_section'))) return;

    const rollback: Array<{
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
