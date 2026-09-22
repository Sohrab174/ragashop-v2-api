import { MigrationInterface, QueryRunner } from 'typeorm';
import { dropIndexIfExists, indexExists } from '../migration-utils';

async function addIndexIfMissing(
  queryRunner: QueryRunner,
  tableName: string,
  indexName: string,
  columnsSql: string,
): Promise<void> {
  if (!(await indexExists(queryRunner, tableName, indexName))) {
    await queryRunner.query(
      `ALTER TABLE \`${tableName}\` ADD INDEX \`${indexName}\` (${columnsSql})`,
    );
  }
}

export class phase2b1SafeIndexHardening1790000000001
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await addIndexIfMissing(
      queryRunner,
      'transaction',
      'fk_transaction_order1_idx',
      '`orderId`',
    );
    await addIndexIfMissing(
      queryRunner,
      'transaction',
      'fk_transaction_customer1_idx',
      '`customerId`',
    );
    await addIndexIfMissing(
      queryRunner,
      'transaction',
      'fk_transaction_gateway1_idx',
      '`gatewayId`',
    );

    await addIndexIfMissing(
      queryRunner,
      'product',
      'idx_product_source_sourceId',
      '`source`, `sourceId`',
    );

    await addIndexIfMissing(
      queryRunner,
      'product_attribute_value',
      'idx_pav_attributeValueId',
      '`attributeValueId`',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await dropIndexIfExists(
      queryRunner,
      'product_attribute_value',
      'idx_pav_attributeValueId',
    );
    await dropIndexIfExists(
      queryRunner,
      'product',
      'idx_product_source_sourceId',
    );
    await dropIndexIfExists(
      queryRunner,
      'transaction',
      'fk_transaction_gateway1_idx',
    );
    await dropIndexIfExists(
      queryRunner,
      'transaction',
      'fk_transaction_customer1_idx',
    );
    await dropIndexIfExists(
      queryRunner,
      'transaction',
      'fk_transaction_order1_idx',
    );
  }
}
