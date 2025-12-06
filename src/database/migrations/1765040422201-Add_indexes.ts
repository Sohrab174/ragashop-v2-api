import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIndexes1765040422201 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // PRODUCT
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_product_isDeleted
      ON product (is_deleted);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_product_categoryId
      ON product (category_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_product_status
      ON product (status);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_product_sourceGroupId
      ON product (source_group_id);
    `);

    // PRODUCT_ATTRIBUTE_VALUE
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pav_productId
      ON product_attribute_value (product_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pav_isDeleted
      ON product_attribute_value (is_deleted);
    `);

    // ATTRIBUTE_VALUE
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_attributeValue_attributeId
      ON attribute_value (attribute_id);
    `);

    // INCREDIBLE_OFFER
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_offer_productId
      ON incredible_offer (product_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_offer_attrValueId
      ON incredible_offer (product_attribute_value_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_offer_fromDate
      ON incredible_offer (from_date);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_offer_toDate
      ON incredible_offer (to_date);
    `);

    // PRODUCT_GALLERY
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_gallery_productId
      ON product_gallery (product_id);
    `);

    // PRODUCT_DESCRIPTION
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_description_productId
      ON product_description (product_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_product_isDeleted`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_product_categoryId`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_product_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_product_sourceGroupId`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_pav_productId`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pav_isDeleted`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_attributeValue_attributeId`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS idx_offer_productId`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_offer_attrValueId`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_offer_fromDate`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_offer_toDate`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_gallery_productId`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_description_productId`);
  }
}
