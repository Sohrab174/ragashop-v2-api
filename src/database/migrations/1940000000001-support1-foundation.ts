import { MigrationInterface, QueryRunner } from 'typeorm';
import { tableExists } from '../migration-utils';

/**
 * SUPPORT-1 — customer support requests and append-only messages.
 * Does not alter orders, payments, or inventory.
 */
export class support1Foundation1940000000001 implements MigrationInterface {
  name = 'support1Foundation1940000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'support_request'))) {
      await queryRunner.query(`
        CREATE TABLE \`support_request\` (
          \`id\` int NOT NULL AUTO_INCREMENT,
          \`customerId\` int NOT NULL,
          \`orderId\` int NULL,
          \`category\` varchar(32) NOT NULL,
          \`subject\` varchar(120) NOT NULL,
          \`status\` varchar(32) NOT NULL,
          \`createdAt\` datetime NOT NULL,
          \`updatedAt\` datetime NOT NULL,
          PRIMARY KEY (\`id\`),
          KEY \`idx_support_request_customer\` (\`customerId\`),
          KEY \`idx_support_request_order\` (\`orderId\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }
    if (!(await tableExists(queryRunner, 'support_message'))) {
      await queryRunner.query(`
        CREATE TABLE \`support_message\` (
          \`id\` int NOT NULL AUTO_INCREMENT,
          \`supportRequestId\` int NOT NULL,
          \`senderType\` varchar(16) NOT NULL,
          \`customerId\` int NULL,
          \`userId\` int NULL,
          \`body\` text NOT NULL,
          \`createdAt\` datetime NOT NULL,
          PRIMARY KEY (\`id\`),
          KEY \`idx_support_message_request\` (\`supportRequestId\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `support_message`');
    await queryRunner.query('DROP TABLE IF EXISTS `support_request`');
  }
}
