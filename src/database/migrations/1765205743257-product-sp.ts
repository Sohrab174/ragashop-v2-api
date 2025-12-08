import { MigrationInterface, QueryRunner } from 'typeorm';

export class productSp1765205743257 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP PROCEDURE IF EXISTS get_product_details`);
    await queryRunner.query(`  CREATE PROCEDURE get_product_details(IN p_product_id BIGINT)  BEGIN   DECLARE v_now DATETIME;   SET v_now = NOW();
   SELECT    p.id AS productId,    p.name,    p.price,    p.status,    p.categoryId,    p.cover,
    b.id AS brandId,    b.name AS brandName,
    cat.id AS categoryId,    cat.name AS categoryName,
    pio.id AS productOfferId,    pio.discountedPrice AS productOfferPrice,    pio.toDate AS productOfferExpire,
    pav.id AS productAttributeValueId,    av.value AS attributeValue,    a.name AS attributeName,
    paio.id AS attributeOfferId,    paio.discountedPrice AS attributeOfferPrice,    paio.toDate AS attributeOfferExpire
   FROM product p   INNER JOIN category cat ON cat.id = p.categoryId   LEFT JOIN brand b ON b.id = p.brandId   LEFT JOIN incredible_offer pio    ON pio.productId = p.id    AND pio.productAttributeValueId IS NULL    AND pio.fromDate <= v_now    AND pio.toDate >= v_now   LEFT JOIN product_attribute_value pav    ON pav.productId = p.id    AND pav.isDeleted = 0   LEFT JOIN attribute_value av ON av.id = pav.attributeValueId   LEFT JOIN attribute a ON a.id = av.attributeId   LEFT JOIN incredible_offer paio    ON paio.productAttributeValueId = pav.id    AND paio.fromDate <= v_now    AND paio.toDate >= v_now   WHERE    p.id = p_product_id    AND p.isDeleted = 0    AND p.status = 'active'    AND p.categoryId != 1;  END `);
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP PROCEDURE IF EXISTS get_product_details;
    `);
  }
}
