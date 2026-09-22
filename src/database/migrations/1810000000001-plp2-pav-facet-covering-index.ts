import { MigrationInterface, QueryRunner } from 'typeorm';
import { dropIndexIfExists, indexExists } from '../migration-utils';

/**
 * PLP-2 closure: covering composite on product_attribute_value for the
 * Product → PAV → AttributeValue facet aggregation path.
 *
 * Tradeoff: extra secondary index storage + slightly higher PAV write cost;
 * read path for large-scope attribute facets uses (productId, isDeleted)
 * lookup and can cover attributeValueId without row lookups ("Using index").
 */
export class plp2PavFacetCoveringIndex1810000000001
  implements MigrationInterface
{
  name = 'plp2PavFacetCoveringIndex1810000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = 'product_attribute_value';
    const indexName = 'idx_pav_productId_isDeleted_attributeValueId';
    if (!(await indexExists(queryRunner, table, indexName))) {
      await queryRunner.query(
        `ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (\`productId\`, \`isDeleted\`, \`attributeValueId\`)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await dropIndexIfExists(
      queryRunner,
      'product_attribute_value',
      'idx_pav_productId_isDeleted_attributeValueId',
    );
  }
}
