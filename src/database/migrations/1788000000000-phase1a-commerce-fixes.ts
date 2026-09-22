import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addColumnIfMissing,
  addUniqueIndexIfMissing,
  dropColumnIfExists,
  dropIndexIfExists,
  tableExists,
} from '../migration-utils';

export class phase1aCommerceFixes1788000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'referral_award'))) {
      await queryRunner.query(`
        CREATE TABLE \`referral_award\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`orderId\` INT NOT NULL,
          \`referrerCustomerId\` INT NOT NULL,
          \`referredCustomerId\` INT NOT NULL,
          \`walletUSD\` DECIMAL(20,2) NOT NULL DEFAULT '0.00',
          \`walletIRT\` DECIMAL(20,2) NOT NULL DEFAULT '0.00',
          \`walletTRY\` DECIMAL(20,2) NOT NULL DEFAULT '0.00',
          \`createdAt\` DATETIME NOT NULL,
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`uq_referral_award_orderId\` (\`orderId\` ASC),
          INDEX \`fk_referral_award_order_idx\` (\`orderId\` ASC),
          INDEX \`fk_referral_award_referrer_idx\` (\`referrerCustomerId\` ASC),
          CONSTRAINT \`fk_referral_award_order\`
            FOREIGN KEY (\`orderId\`)
            REFERENCES \`order\` (\`id\`)
            ON DELETE NO ACTION
            ON UPDATE NO ACTION,
          CONSTRAINT \`fk_referral_award_referrer\`
            FOREIGN KEY (\`referrerCustomerId\`)
            REFERENCES \`customer\` (\`id\`)
            ON DELETE NO ACTION
            ON UPDATE NO ACTION
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }

    await addColumnIfMissing(
      queryRunner,
      'transaction',
      'gatewayRedirectUrl',
      '`gatewayRedirectUrl` VARCHAR(512) NULL DEFAULT NULL AFTER `randomToken`',
    );

    const duplicateNumbers = await queryRunner.query(`
      SELECT number, COUNT(*) AS cnt
      FROM \`order\`
      GROUP BY number
      HAVING COUNT(*) > 1
      LIMIT 1;
    `);

    if (duplicateNumbers?.length) {
      throw new Error(
        `PHASE1A_MIGRATION_BLOCKED: duplicate order.number values exist (example: ${duplicateNumbers[0].number}). Resolve LOCAL duplicates before adding uq_order_number.`,
      );
    }

    await addUniqueIndexIfMissing(
      queryRunner,
      'order',
      'uq_order_number',
      '`number` ASC',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await dropColumnIfExists(queryRunner, 'transaction', 'gatewayRedirectUrl');

    if (await tableExists(queryRunner, 'referral_award')) {
      await queryRunner.query(`DROP TABLE IF EXISTS \`referral_award\`;`);
    }

    await dropIndexIfExists(queryRunner, 'order', 'uq_order_number');
  }
}
