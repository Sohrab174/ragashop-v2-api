import { MigrationInterface, QueryRunner } from 'typeorm';

export class spAttributeFilters1753394284491 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP PROCEDURE IF EXISTS sp_GetAttributesForFilter;`,
    );
    await queryRunner.query(`CREATE PROCEDURE sp_GetAttributesForFilter(IN categoryId INT)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        DROP TEMPORARY TABLE IF EXISTS product_count_subquery;
        DROP TEMPORARY TABLE IF EXISTS attributes_list;
        DROP TEMPORARY TABLE IF EXISTS filtered_attributes_list;
        DROP TEMPORARY TABLE IF EXISTS attribute_values_list;
        RESIGNAL;
    END;

    -- Product count subquery
    DROP TEMPORARY TABLE IF EXISTS product_count_subquery;
    CREATE TEMPORARY TABLE product_count_subquery (
        attributeId INT PRIMARY KEY,
        productCount INT
    );

    INSERT INTO product_count_subquery (attributeId, productCount)
    SELECT
        av.attributeId,
        COUNT(DISTINCT pav.productId) AS productCount
    FROM attribute_value av
    INNER JOIN product_attribute_value pav ON pav.attributeValueId = av.id AND pav.isDeleted = 0
    INNER JOIN product p ON p.id = pav.productId AND p.isDeleted = 0 AND p.status = 1
    INNER JOIN category c ON c.id = p.categoryId AND c.status = 1
    WHERE p.categoryId != 1
    GROUP BY av.attributeId;

    -- Get attributes
    DROP TEMPORARY TABLE IF EXISTS attributes_list;
    CREATE TEMPORARY TABLE attributes_list (
        attributeId INT PRIMARY KEY,
        attributeName VARCHAR(255),
        attributeType VARCHAR(50),
        productCount INT
    );

    INSERT INTO attributes_list (attributeId, attributeName, attributeType, productCount)
    SELECT
        a.id,
        a.name,
        a.type,
        pc.productCount
    FROM attribute a
    INNER JOIN product_count_subquery pc ON pc.attributeId = a.id
    WHERE a.name != 'مبدأ'
    ORDER BY pc.productCount DESC
    LIMIT 20;

    -- Apply category filter
    DROP TEMPORARY TABLE IF EXISTS filtered_attributes_list;
    IF categoryId IS NOT NULL THEN
        CREATE TEMPORARY TABLE filtered_attributes_list (
            attributeId INT PRIMARY KEY,
            attributeName VARCHAR(255),
            attributeType VARCHAR(50),
            productCount INT
        );

        INSERT INTO filtered_attributes_list (attributeId, attributeName, attributeType, productCount)
        SELECT al.attributeId, al.attributeName, al.attributeType, al.productCount
        FROM attributes_list al
        WHERE EXISTS (
            SELECT 1
            FROM product_attribute_value pav2
            INNER JOIN product p2 ON p2.id = pav2.productId AND p2.isDeleted = 0 AND p2.status = 1
            INNER JOIN category c2 ON c2.id = p2.categoryId AND c2.status = 1
            WHERE pav2.attributeValueId IN (
                SELECT av2.id
                FROM attribute_value av2
                WHERE av2.attributeId = al.attributeId
            )
            AND p2.categoryId = categoryId
        );
    ELSE
        CREATE TEMPORARY TABLE filtered_attributes_list AS
        SELECT * FROM attributes_list;
    END IF;

    -- Get DISTINCT attribute values
    DROP TEMPORARY TABLE IF EXISTS attribute_values_list;
    CREATE TEMPORARY TABLE attribute_values_list (
        attributeValueId INT PRIMARY KEY,
        attributeValueName VARCHAR(255),
        attributeId INT,
        INDEX idx_attribute_id (attributeId)
    );

    INSERT IGNORE INTO attribute_values_list (attributeValueId, attributeValueName, attributeId)
    SELECT DISTINCT
        av.id,
        av.name,
        av.attributeId
    FROM attribute_value av
    INNER JOIN product_attribute_value pav ON pav.attributeValueId = av.id AND pav.isDeleted = 0
    INNER JOIN product p ON p.id = pav.productId AND p.isDeleted = 0 AND p.status = 1
    INNER JOIN category c ON c.id = p.categoryId AND c.status = 1
    WHERE av.attributeId IN (SELECT attributeId FROM filtered_attributes_list)
    AND p.categoryId != 1
    AND CHAR_LENGTH(av.name) <= 30
    AND (categoryId IS NULL OR p.categoryId = categoryId)
    ORDER BY av.name ASC;

    -- Final result with JSON
    SELECT
        fa.attributeId,
        fa.attributeName,
        fa.attributeType,
        fa.productCount,
        COALESCE(
            JSON_ARRAYAGG(
                CASE
                    WHEN avl.attributeValueId IS NOT NULL
                    THEN JSON_OBJECT(
                        'id', avl.attributeValueId,
                        'name', avl.attributeValueName
                    )
                    ELSE NULL
                END
            ),
            JSON_ARRAY()
        ) as attributeValues
    FROM filtered_attributes_list fa
    LEFT JOIN attribute_values_list avl ON fa.attributeId = avl.attributeId
    GROUP BY fa.attributeId, fa.attributeName, fa.attributeType, fa.productCount
    ORDER BY fa.productCount DESC;

    -- Clean up
    DROP TEMPORARY TABLE IF EXISTS product_count_subquery;
    DROP TEMPORARY TABLE IF EXISTS attributes_list;
    DROP TEMPORARY TABLE IF EXISTS filtered_attributes_list;
    DROP TEMPORARY TABLE IF EXISTS attribute_values_list;
END;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    //
  }
}
