import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fix shoe source categories incorrectly parented under Dog Collars (Pet Shop).
 *
 * Evidence-based on Trendyol sourceId + hierarchy (not Persian titles).
 * Idempotent: a second run updates 0 rows.
 * Does NOT touch product.categoryId, mappings, orders, customers, or setting.
 *
 * Do NOT run against production or the live local DB without explicit approval.
 * Verified first on an isolated database copy.
 */
export class fixPetShoeParentMislink1980000000001
  implements MigrationInterface
{
  name = 'fixPetShoeParentMislink1980000000001';

  private static readonly SHOE_SOURCE_IDS = [
    '1108',
    '104543',
    '101421',
    '113',
  ] as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const collars = await queryRunner.query(
      `SELECT id FROM category
       WHERE source = 'trendyol'
         AND sourceId = '1352'
         AND hierarchy = 'Supermarket/Pet Shop Products/Dog Products/Dog Collars'
       LIMIT 2`,
    );
    const shoesRoot = await queryRunner.query(
      `SELECT id FROM category
       WHERE source = 'trendyol'
         AND sourceId = '114'
         AND sourceName = 'Ayakkabı'
       LIMIT 2`,
    );

    if (!collars.length || !shoesRoot.length) {
      // Environment without this taxonomy shape — no-op (safe for empty DBs).
      return;
    }
    if (collars.length !== 1 || shoesRoot.length !== 1) {
      throw new Error(
        'fixPetShoeParentMislink: ambiguous Dog Collars or Ayakkabı root',
      );
    }

    const collarsId = Number(collars[0].id);
    const shoesRootId = Number(shoesRoot[0].id);

    const candidates = await queryRunner.query(
      `SELECT id, sourceId, parentId, hierarchy
       FROM category
       WHERE source = 'trendyol'
         AND sourceId IN (?, ?, ?, ?)
         AND hierarchy LIKE ?
         AND hierarchy LIKE ?`,
      [
        ...fixPetShoeParentMislink1980000000001.SHOE_SOURCE_IDS,
        'Ayakkab%',
        '%Günlük%',
      ],
    );

    const underCollars = candidates.filter(
      (row: { parentId: number }) => Number(row.parentId) === collarsId,
    );
    if (underCollars.length === 0) {
      // Already fixed or never present.
      return;
    }
    if (underCollars.length !== 4) {
      throw new Error(
        `fixPetShoeParentMislink: expected 4 mis-parented shoe rows, found ${underCollars.length}`,
      );
    }

    await queryRunner.query(
      `UPDATE category
       SET parentId = ?
       WHERE source = 'trendyol'
         AND parentId = ?
         AND sourceId IN (?, ?, ?, ?)
         AND hierarchy LIKE ?
         AND hierarchy LIKE ?`,
      [
        shoesRootId,
        collarsId,
        ...fixPetShoeParentMislink1980000000001.SHOE_SOURCE_IDS,
        'Ayakkab%',
        '%Günlük%',
      ],
    );

    const stillWrong = await queryRunner.query(
      `SELECT COUNT(*) AS n
       FROM category shoe
       JOIN category collars ON collars.id = shoe.parentId
       WHERE collars.sourceId = '1352'
         AND shoe.hierarchy LIKE 'Ayakkabı/%'`,
    );
    if (Number(stillWrong[0].n) !== 0) {
      throw new Error(
        'fixPetShoeParentMislink: shoe hierarchy still under Dog Collars',
      );
    }

    const ballerina = await queryRunner.query(
      `SELECT COUNT(*) AS n
       FROM category flat
       JOIN category babet ON babet.id = flat.parentId
       WHERE flat.sourceId = '410'
         AND babet.sourceId = '113'`,
    );
    if (Number(ballerina[0].n) !== 1) {
      throw new Error(
        'fixPetShoeParentMislink: Ballerina must remain under Babet',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const collars = await queryRunner.query(
      `SELECT id FROM category
       WHERE source = 'trendyol'
         AND sourceId = '1352'
         AND hierarchy = 'Supermarket/Pet Shop Products/Dog Products/Dog Collars'
       LIMIT 1`,
    );
    const shoesRoot = await queryRunner.query(
      `SELECT id FROM category
       WHERE source = 'trendyol'
         AND sourceId = '114'
         AND sourceName = 'Ayakkabı'
       LIMIT 1`,
    );
    if (!collars.length || !shoesRoot.length) return;

    await queryRunner.query(
      `UPDATE category
       SET parentId = ?
       WHERE source = 'trendyol'
         AND parentId = ?
         AND sourceId IN (?, ?, ?, ?)
         AND hierarchy LIKE ?
         AND hierarchy LIKE ?`,
      [
        Number(collars[0].id),
        Number(shoesRoot[0].id),
        ...fixPetShoeParentMislink1980000000001.SHOE_SOURCE_IDS,
        'Ayakkab%',
        '%Günlük%',
      ],
    );
  }
}
