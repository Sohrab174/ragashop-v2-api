import { MigrationInterface, QueryRunner } from 'typeorm';
import { tableExists } from '../migration-utils';

/**
 * HOME-1 — Storefront Home merchandising foundation (additive).
 * Typed section rows + optional schedule; catalog entities stay authoritative.
 */
export class phaseHome1StorefrontHomeMerchandising1920000000001
  implements MigrationInterface
{
  name = 'phaseHome1StorefrontHomeMerchandising1920000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'storefront_home_section'))) {
      await queryRunner.query(`
        CREATE TABLE \`storefront_home_section\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`sectionKey\` VARCHAR(64) NOT NULL,
          \`enabled\` TINYINT(1) NOT NULL DEFAULT 1,
          \`displayOrder\` INT NOT NULL DEFAULT 100,
          \`title\` VARCHAR(128) NULL,
          \`subtitle\` VARCHAR(255) NULL,
          \`configJson\` TEXT NULL,
          \`startAt\` DATETIME NULL,
          \`endAt\` DATETIME NULL,
          \`createdAt\` DATETIME NOT NULL,
          \`updatedAt\` DATETIME NULL,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uk_storefront_home_section_key\` (\`sectionKey\`),
          KEY \`idx_storefront_home_section_order\` (\`displayOrder\`, \`enabled\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }

    // Seed defaults aligned with current storefront Home (no remote URLs).
    const existing = await queryRunner.query(
      `SELECT COUNT(*) AS c FROM \`storefront_home_section\``,
    );
    const count = Number(existing?.[0]?.c ?? 0);
    if (count === 0) {
      const now = new Date();
      const rows: Array<{
        sectionKey: string;
        enabled: number;
        displayOrder: number;
        title: string | null;
        subtitle: string | null;
        configJson: string;
      }> = [
        {
          sectionKey: 'link_shopping',
          enabled: 0,
          displayOrder: 5,
          title: null,
          subtitle: null,
          configJson: '{}',
        },
        {
          sectionKey: 'quick_guide',
          enabled: 1,
          displayOrder: 8,
          title: null,
          subtitle: null,
          configJson: '{}',
        },
        {
          sectionKey: 'campaign',
          enabled: 1,
          displayOrder: 10,
          title: 'منتخب ویراستاری RagaShop',
          subtitle:
            'یک نگاه تجاری به انتخاب‌های کاتالوگ — برای کشف و خرید',
          configJson: JSON.stringify({
            eyebrow: 'انتخاب هفته',
            ctaLabel: 'مشاهده انتخاب',
            ctaDestinationType: 'newest_rail_category',
            preferredProductId: 155209,
            galleryImageIndex: 0,
            objectPositionDesktop: '50% 18%',
            objectPositionMobile: '50% 22%',
          }),
        },
        {
          sectionKey: 'categories',
          enabled: 1,
          displayOrder: 20,
          title: null,
          subtitle: null,
          configJson: JSON.stringify({
            limit: 8,
            presentation: [
              {
                categoryId: 1,
                preferredProductId: 155213,
                objectPosition: '50% 12%',
              },
              {
                categoryId: 6,
                preferredProductId: 54533,
                objectPosition: '50% 25%',
              },
              {
                categoryId: 11,
                preferredProductId: 97575,
                objectPosition: '50% 20%',
              },
              {
                categoryId: 14,
                preferredProductId: 96826,
                objectPosition: '50% 50%',
              },
              {
                categoryId: 16,
                preferredProductId: 1347,
                objectPosition: '50% 50%',
              },
              {
                categoryId: 17,
                preferredProductId: 62409,
                objectPosition: '50% 30%',
              },
            ],
          }),
        },
        {
          sectionKey: 'newest',
          enabled: 1,
          displayOrder: 30,
          title: 'تازه‌واردهای RagaShop',
          subtitle: 'به‌تازگی به کاتالوگ فعال اضافه شده‌اند',
          configJson: JSON.stringify({
            source: 'newest',
            limit: 12,
            seeAllLabel: 'مشاهده همه',
          }),
        },
        {
          sectionKey: 'editorial_promo',
          enabled: 0,
          displayOrder: 35,
          title: null,
          subtitle: null,
          configJson: JSON.stringify({
            preferredProductId: 155213,
            galleryImageIndex: 0,
            objectPosition: '50% 14%',
          }),
        },
        {
          sectionKey: 'category_spotlight',
          enabled: 0,
          displayOrder: 36,
          title: null,
          subtitle: null,
          configJson: JSON.stringify({ limit: 6 }),
        },
        {
          sectionKey: 'discounts',
          enabled: 1,
          displayOrder: 40,
          title: 'تخفیف‌های جذاب',
          subtitle: 'پیشنهادهایی با تخفیف واقعی از کاتالوگ',
          configJson: JSON.stringify({
            source: 'curated',
            limit: 12,
            seeAllLabel: 'مشاهده همه',
            productIds: [155194, 155190, 84425, 46848, 1347, 62409],
            fallbackSource: 'discount',
          }),
        },
        {
          sectionKey: 'paste_link',
          enabled: 1,
          displayOrder: 50,
          title: 'محصولت اینجا نیست؟ لینک بده',
          subtitle: null,
          configJson: '{}',
        },
      ];

      for (const row of rows) {
        await queryRunner.query(
          `
          INSERT INTO \`storefront_home_section\`
            (\`sectionKey\`, \`enabled\`, \`displayOrder\`, \`title\`, \`subtitle\`, \`configJson\`, \`createdAt\`)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
          [
            row.sectionKey,
            row.enabled,
            row.displayOrder,
            row.title,
            row.subtitle,
            row.configJson,
            now,
          ],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await tableExists(queryRunner, 'storefront_home_section')) {
      await queryRunner.query(`DROP TABLE \`storefront_home_section\``);
    }
  }
}
