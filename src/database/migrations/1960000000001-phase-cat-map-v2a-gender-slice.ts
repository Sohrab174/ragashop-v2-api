import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addColumnIfMissing,
  addIndexIfMissing,
  addUniqueIndexIfMissing,
  columnExists,
  dropForeignKeyIfExists,
  dropIndexIfExists,
  foreignKeyExists,
  indexExists,
  tableExists,
} from '../migration-utils';

/**
 * CAT-MAP-V2-A — gender-sliced source_category_mapping (schema + compat only).
 *
 * - Adds genderSlice + reviewStatus
 * - Backfills existing rows to genderSlice=any, reviewStatus=legacy_unreviewed
 * - Replaces UNIQUE(sourceCategoryId) with UNIQUE(sourceCategoryId, genderSlice)
 *
 * Does NOT change discovery semantics. Does NOT convert rows to female/male.
 */
export class phaseCatMapV2aGenderSlice1960000000001
  implements MigrationInterface
{
  name = 'phaseCatMapV2aGenderSlice1960000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'source_category_mapping'))) {
      return;
    }

    await addColumnIfMissing(
      queryRunner,
      'source_category_mapping',
      'genderSlice',
      `\`genderSlice\` ENUM('female','male','unisex','any') NULL AFTER \`canonicalCategoryId\``,
    );

    await addColumnIfMissing(
      queryRunner,
      'source_category_mapping',
      'reviewStatus',
      `\`reviewStatus\` ENUM('legacy_unreviewed','reviewed_ok','needs_review','migrated') NOT NULL DEFAULT 'legacy_unreviewed' AFTER \`status\``,
    );

    await queryRunner.query(`
      UPDATE source_category_mapping
      SET genderSlice = 'any'
      WHERE genderSlice IS NULL
    `);

    await queryRunner.query(`
      UPDATE source_category_mapping
      SET reviewStatus = 'legacy_unreviewed'
      WHERE reviewStatus IS NULL
         OR reviewStatus NOT IN ('legacy_unreviewed','reviewed_ok','needs_review','migrated')
    `);

    const nullSlices = await queryRunner.query(`
      SELECT COUNT(*) AS cnt
      FROM source_category_mapping
      WHERE genderSlice IS NULL
    `);
    if (Number(nullSlices?.[0]?.cnt || 0) > 0) {
      throw new Error(
        'CAT-MAP-V2-A: genderSlice backfill left NULL rows; aborting NOT NULL alter.',
      );
    }

    // Make genderSlice NOT NULL (MariaDB may already be NOT NULL if re-run after partial).
    const genderCol = await queryRunner.query(
      `SHOW COLUMNS FROM \`source_category_mapping\` LIKE 'genderSlice'`,
    );
    if (genderCol?.[0]?.Null === 'YES') {
      await queryRunner.query(`
        ALTER TABLE \`source_category_mapping\`
        MODIFY COLUMN \`genderSlice\` ENUM('female','male','unisex','any') NOT NULL DEFAULT 'any'
      `);
    }

    // Swap unique index. FK fk_scm_source_category depends on an index covering sourceCategoryId.
    await dropForeignKeyIfExists(
      queryRunner,
      'source_category_mapping',
      'fk_scm_source_category',
    );

    await dropIndexIfExists(
      queryRunner,
      'source_category_mapping',
      'uq_source_category_mapping_sourceCategoryId',
    );

    await addUniqueIndexIfMissing(
      queryRunner,
      'source_category_mapping',
      'uq_scm_source_category_gender_slice',
      '`sourceCategoryId`, `genderSlice`',
    );

    if (
      !(await foreignKeyExists(
        queryRunner,
        'source_category_mapping',
        'fk_scm_source_category',
      ))
    ) {
      await queryRunner.query(`
        ALTER TABLE \`source_category_mapping\`
        ADD CONSTRAINT \`fk_scm_source_category\`
          FOREIGN KEY (\`sourceCategoryId\`) REFERENCES \`category\`(\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION
      `);
    }

    // Replace single-column canonical index with composite (FK depends on that index).
    await dropForeignKeyIfExists(
      queryRunner,
      'source_category_mapping',
      'fk_scm_canonical_category',
    );
    await dropIndexIfExists(
      queryRunner,
      'source_category_mapping',
      'idx_scm_canonicalCategoryId',
    );
    await addIndexIfMissing(
      queryRunner,
      'source_category_mapping',
      'idx_scm_canonical_status_slice',
      '`canonicalCategoryId`, `status`, `genderSlice`',
    );
    if (
      !(await foreignKeyExists(
        queryRunner,
        'source_category_mapping',
        'fk_scm_canonical_category',
      ))
    ) {
      await queryRunner.query(`
        ALTER TABLE \`source_category_mapping\`
        ADD CONSTRAINT \`fk_scm_canonical_category\`
          FOREIGN KEY (\`canonicalCategoryId\`) REFERENCES \`canonical_category\`(\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION
      `);
    }

    await addIndexIfMissing(
      queryRunner,
      'source_category_mapping',
      'idx_scm_review_status',
      '`reviewStatus`, `status`',
    );

    // Keep provider filter index if missing (idempotent).
    await addIndexIfMissing(
      queryRunner,
      'source_category_mapping',
      'idx_scm_source',
      '`source`',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'source_category_mapping'))) {
      return;
    }

    const multiSliceGroups = await queryRunner.query(`
      SELECT sourceCategoryId, COUNT(*) AS cnt,
             GROUP_CONCAT(id ORDER BY id) AS mappingIds,
             GROUP_CONCAT(genderSlice ORDER BY id) AS slices
      FROM source_category_mapping
      GROUP BY sourceCategoryId
      HAVING cnt > 1
    `);

    if (multiSliceGroups.length > 0) {
      const detail = multiSliceGroups
        .map(
          (g: any) =>
            `sourceCategoryId=${g.sourceCategoryId} mappings=[${g.mappingIds}] slices=[${g.slices}]`,
        )
        .join('; ');
      throw new Error(
        `CAT-MAP-V2-A down refused: multiple genderSlice rows exist for one sourceCategoryId. Resolve manually before restoring UNIQUE(sourceCategoryId). ${detail}`,
      );
    }

    await dropIndexIfExists(
      queryRunner,
      'source_category_mapping',
      'idx_scm_review_status',
    );

    await dropForeignKeyIfExists(
      queryRunner,
      'source_category_mapping',
      'fk_scm_canonical_category',
    );
    await dropIndexIfExists(
      queryRunner,
      'source_category_mapping',
      'idx_scm_canonical_status_slice',
    );
    await addIndexIfMissing(
      queryRunner,
      'source_category_mapping',
      'idx_scm_canonicalCategoryId',
      '`canonicalCategoryId`',
    );
    if (
      !(await foreignKeyExists(
        queryRunner,
        'source_category_mapping',
        'fk_scm_canonical_category',
      ))
    ) {
      await queryRunner.query(`
        ALTER TABLE \`source_category_mapping\`
        ADD CONSTRAINT \`fk_scm_canonical_category\`
          FOREIGN KEY (\`canonicalCategoryId\`) REFERENCES \`canonical_category\`(\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION
      `);
    }

    await dropForeignKeyIfExists(
      queryRunner,
      'source_category_mapping',
      'fk_scm_source_category',
    );

    await dropIndexIfExists(
      queryRunner,
      'source_category_mapping',
      'uq_scm_source_category_gender_slice',
    );

    await addUniqueIndexIfMissing(
      queryRunner,
      'source_category_mapping',
      'uq_source_category_mapping_sourceCategoryId',
      '`sourceCategoryId`',
    );

    if (
      !(await foreignKeyExists(
        queryRunner,
        'source_category_mapping',
        'fk_scm_source_category',
      ))
    ) {
      await queryRunner.query(`
        ALTER TABLE \`source_category_mapping\`
        ADD CONSTRAINT \`fk_scm_source_category\`
          FOREIGN KEY (\`sourceCategoryId\`) REFERENCES \`category\`(\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION
      `);
    }

    if (await columnExists(queryRunner, 'source_category_mapping', 'reviewStatus')) {
      await queryRunner.query(
        `ALTER TABLE \`source_category_mapping\` DROP COLUMN \`reviewStatus\``,
      );
    }
    if (await columnExists(queryRunner, 'source_category_mapping', 'genderSlice')) {
      await queryRunner.query(
        `ALTER TABLE \`source_category_mapping\` DROP COLUMN \`genderSlice\``,
      );
    }

    // Ensure source index remains (may already exist).
    if (
      !(await indexExists(queryRunner, 'source_category_mapping', 'idx_scm_source'))
    ) {
      await addIndexIfMissing(
        queryRunner,
        'source_category_mapping',
        'idx_scm_source',
        '`source`',
      );
    }
  }
}
