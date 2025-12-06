import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIndexes1765040422201 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Helper to check and create an index
    const createIndexIfNotExists = async (
      tableName: string,
      indexName: string,
      indexCols: string,
    ) => {
      const checkSql = `
        SELECT COUNT(1) AS cnt
        FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND index_name = ?
      `;
      const res: any[] = await queryRunner.query(checkSql, [
        tableName,
        indexName,
      ]);
      const cnt =
        res && res[0] && (res[0].cnt ?? res[0].CNT ?? res[0].Cnt)
          ? res[0].cnt
          : (res[0] as any)['cnt'] || 0;
      if (Number(cnt) === 0) {
        await queryRunner.query(
          `CREATE INDEX \`${indexName}\` ON \`${tableName}\` (${indexCols})`,
        );
      }
    };

    // PRODUCT
    await createIndexIfNotExists(
      'product',
      'idx_product_isDeleted',
      '`is_deleted`',
    );
    await createIndexIfNotExists(
      'product',
      'idx_product_categoryId',
      '`category_id`',
    );
    await createIndexIfNotExists('product', 'idx_product_status', '`status`');
    await createIndexIfNotExists(
      'product',
      'idx_product_sourceGroupId',
      '`source_group_id`',
    );

    // PRODUCT_ATTRIBUTE_VALUE
    await createIndexIfNotExists(
      'product_attribute_value',
      'idx_pav_productId',
      '`product_id`',
    );
    await createIndexIfNotExists(
      'product_attribute_value',
      'idx_pav_isDeleted',
      '`is_deleted`',
    );

    // ATTRIBUTE_VALUE
    await createIndexIfNotExists(
      'attribute_value',
      'idx_attributeValue_attributeId',
      '`attribute_id`',
    );

    // INCREDIBLE_OFFER
    await createIndexIfNotExists(
      'incredible_offer',
      'idx_offer_productId',
      '`product_id`',
    );
    await createIndexIfNotExists(
      'incredible_offer',
      'idx_offer_attrValueId',
      '`product_attribute_value_id`',
    );
    await createIndexIfNotExists(
      'incredible_offer',
      'idx_offer_fromDate',
      '`from_date`',
    );
    await createIndexIfNotExists(
      'incredible_offer',
      'idx_offer_toDate',
      '`to_date`',
    );

    // PRODUCT_GALLERY
    await createIndexIfNotExists(
      'product_gallery',
      'idx_gallery_productId',
      '`product_id`',
    );

    // PRODUCT_DESCRIPTION
    await createIndexIfNotExists(
      'product_description',
      'idx_description_productId',
      '`product_id`',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const exists = async (tableName: string, indexName: string) => {
      const res: any[] = await queryRunner.query(
        `SELECT COUNT(1) AS cnt FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
        [tableName, indexName],
      );
      const cnt = res && res[0] && res[0].cnt ? res[0].cnt : 0;
      return Number(cnt) > 0;
    };

    // Helper to drop if exists
    const dropIndexIfExists = async (tableName: string, indexName: string) => {
      if (await exists(tableName, indexName)) {
        await queryRunner.query(
          `ALTER TABLE \`${tableName}\` DROP INDEX \`${indexName}\``,
        );
      }
    };

    await dropIndexIfExists('product', 'idx_product_isDeleted');
    await dropIndexIfExists('product', 'idx_product_categoryId');
    await dropIndexIfExists('product', 'idx_product_status');
    await dropIndexIfExists('product', 'idx_product_sourceGroupId');

    await dropIndexIfExists('product_attribute_value', 'idx_pav_productId');
    await dropIndexIfExists('product_attribute_value', 'idx_pav_isDeleted');

    await dropIndexIfExists(
      'attribute_value',
      'idx_attributeValue_attributeId',
    );

    await dropIndexIfExists('incredible_offer', 'idx_offer_productId');
    await dropIndexIfExists('incredible_offer', 'idx_offer_attrValueId');
    await dropIndexIfExists('incredible_offer', 'idx_offer_fromDate');
    await dropIndexIfExists('incredible_offer', 'idx_offer_toDate');

    await dropIndexIfExists('product_gallery', 'idx_gallery_productId');
    await dropIndexIfExists('product_description', 'idx_description_productId');
  }
}
