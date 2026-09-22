import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  dropIndexIfExists,
  indexExists,
  tableExists,
} from '../migration-utils';

/**
 * Cart-1 foundation: session- or customer-owned cart + line items.
 * Additive only — does not touch order/product business data.
 */
export class cartFoundation1820000000001 implements MigrationInterface {
  name = 'cartFoundation1820000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'cart'))) {
      await queryRunner.query(`
        CREATE TABLE \`cart\` (
          \`id\` int NOT NULL AUTO_INCREMENT,
          \`sessionKey\` varchar(64) NULL,
          \`customerId\` int NULL,
          \`createdAt\` datetime NOT NULL,
          \`updatedAt\` datetime NOT NULL,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uq_cart_sessionKey\` (\`sessionKey\`),
          UNIQUE KEY \`uq_cart_customerId\` (\`customerId\`),
          KEY \`idx_cart_customerId\` (\`customerId\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }

    if (!(await tableExists(queryRunner, 'cart_item'))) {
      await queryRunner.query(`
        CREATE TABLE \`cart_item\` (
          \`id\` int NOT NULL AUTO_INCREMENT,
          \`cartId\` int NOT NULL,
          \`productId\` int NOT NULL,
          \`productAttributeValueId\` int NULL,
          \`configKey\` varchar(64) NOT NULL,
          \`quantity\` int NOT NULL,
          \`createdAt\` datetime NOT NULL,
          \`updatedAt\` datetime NOT NULL,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uq_cart_item_cart_config\` (\`cartId\`, \`configKey\`),
          KEY \`idx_cart_item_cartId\` (\`cartId\`),
          KEY \`idx_cart_item_productId\` (\`productId\`),
          CONSTRAINT \`fk_cart_item_cart\`
            FOREIGN KEY (\`cartId\`) REFERENCES \`cart\` (\`id\`)
            ON DELETE CASCADE ON UPDATE NO ACTION
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    } else if (
      !(await indexExists(queryRunner, 'cart_item', 'uq_cart_item_cart_config'))
    ) {
      await queryRunner.query(
        `ALTER TABLE \`cart_item\` ADD UNIQUE KEY \`uq_cart_item_cart_config\` (\`cartId\`, \`configKey\`)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await tableExists(queryRunner, 'cart_item')) {
      await dropIndexIfExists(
        queryRunner,
        'cart_item',
        'uq_cart_item_cart_config',
      );
      await queryRunner.query(`DROP TABLE \`cart_item\``);
    }
    if (await tableExists(queryRunner, 'cart')) {
      await dropIndexIfExists(queryRunner, 'cart', 'uq_cart_sessionKey');
      await dropIndexIfExists(queryRunner, 'cart', 'uq_cart_customerId');
      await queryRunner.query(`DROP TABLE \`cart\``);
    }
  }
}
