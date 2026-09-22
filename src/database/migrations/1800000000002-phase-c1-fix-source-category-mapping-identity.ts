import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  dropForeignKeyIfExists,
  dropIndexIfExists,
  foreignKeyExists,
  indexExists,
} from '../migration-utils';

/**
 * C1 Codex fix pass #1 — mapping identity.
 *
 * BEFORE: UNIQUE(source, sourceCategoryId) allowed the same category.id
 * to appear under different source labels.
 *
 * AFTER: UNIQUE(sourceCategoryId) — category.id is authoritative.
 * `source` remains as denormalized metadata (must match category.source in service).
 *
 * Does not alter category / product / canonical_category rows.
 */
export class phaseC1FixSourceCategoryMappingIdentity1800000000002
  implements MigrationInterface
{
  name = 'phaseC1FixSourceCategoryMappingIdentity1800000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Align denormalized source with authoritative category.source where mismatched.
    await queryRunner.query(`
      UPDATE source_category_mapping m
      INNER JOIN category c ON c.id = m.sourceCategoryId
      SET m.source = c.source
      WHERE c.source IS NOT NULL
        AND BINARY m.source <> BINARY c.source
    `);

    const duplicateGroups = await queryRunner.query(`
      SELECT sourceCategoryId, COUNT(*) AS cnt,
             GROUP_CONCAT(id ORDER BY id) AS mappingIds,
             GROUP_CONCAT(canonicalCategoryId ORDER BY id) AS canonicalIds,
             GROUP_CONCAT(source ORDER BY id) AS sources
      FROM source_category_mapping
      GROUP BY sourceCategoryId
      HAVING cnt > 1
    `);

    if (duplicateGroups.length > 0) {
      const detail = duplicateGroups
        .map(
          (g: any) =>
            `sourceCategoryId=${g.sourceCategoryId} mappings=[${g.mappingIds}] canonicals=[${g.canonicalIds}] sources=[${g.sources}]`,
        )
        .join('; ');
      throw new Error(
        `Cannot apply UNIQUE(sourceCategoryId): conflicting source_category_mapping rows exist. Resolve manually before retry. ${detail}`,
      );
    }

    await dropIndexIfExists(
      queryRunner,
      'source_category_mapping',
      'uq_source_category_mapping_identity',
    );

    // FK currently depends on idx_scm_sourceCategoryId — recreate via unique index.
    await dropForeignKeyIfExists(
      queryRunner,
      'source_category_mapping',
      'fk_scm_source_category',
    );

    await dropIndexIfExists(
      queryRunner,
      'source_category_mapping',
      'idx_scm_sourceCategoryId',
    );

    if (
      !(await indexExists(
        queryRunner,
        'source_category_mapping',
        'uq_source_category_mapping_sourceCategoryId',
      ))
    ) {
      await queryRunner.query(`
        ALTER TABLE \`source_category_mapping\`
        ADD UNIQUE INDEX \`uq_source_category_mapping_sourceCategoryId\` (\`sourceCategoryId\`)
      `);
    }

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

    if (
      !(await indexExists(
        queryRunner,
        'source_category_mapping',
        'idx_scm_source',
      ))
    ) {
      await queryRunner.query(`
        ALTER TABLE \`source_category_mapping\`
        ADD INDEX \`idx_scm_source\` (\`source\`)
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await dropIndexIfExists(
      queryRunner,
      'source_category_mapping',
      'idx_scm_source',
    );

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

    if (
      !(await indexExists(
        queryRunner,
        'source_category_mapping',
        'idx_scm_sourceCategoryId',
      ))
    ) {
      await queryRunner.query(`
        ALTER TABLE \`source_category_mapping\`
        ADD INDEX \`idx_scm_sourceCategoryId\` (\`sourceCategoryId\`)
      `);
    }

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

    if (
      !(await indexExists(
        queryRunner,
        'source_category_mapping',
        'uq_source_category_mapping_identity',
      ))
    ) {
      await queryRunner.query(`
        ALTER TABLE \`source_category_mapping\`
        ADD UNIQUE INDEX \`uq_source_category_mapping_identity\` (\`source\`, \`sourceCategoryId\`)
      `);
    }
  }
}
