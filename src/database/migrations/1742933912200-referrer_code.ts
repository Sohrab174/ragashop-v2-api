import { MigrationInterface, QueryRunner } from 'typeorm';

export class referrerCode1742933912200 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`customer\`
      ADD \`referrerCode\` VARCHAR(45) NULL DEFAULT NULL AFTER \`expireRandomHash\`,
      ADD \`inviteCode\` VARCHAR(45) NULL DEFAULT NULL AFTER \`referrerCode\`;`,
    );

    await queryRunner.query(`ALTER TABLE \`customer\`
    ADD \`walletUSD\` DECIMAL(20,2) NOT NULL DEFAULT '0' AFTER \`inviteCode\`,
    ADD \`walletIRT\` DECIMAL(20,2) NOT NULL DEFAULT '0' AFTER \`walletUSD\`,
    ADD \`walletTRY\` DECIMAL(20,2) NOT NULL DEFAULT '0' AFTER \`walletIRT\`;`);

    await queryRunner.query(
      `ALTER TABLE \`setting\` CHANGE \`shippingCost\` \`maxShippingCost\` DECIMAL(20,2) NOT NULL DEFAULT '0.00';`,
    );

    await queryRunner.query(`ALTER TABLE \`setting\`
    ADD \`shippingPercent\` DECIMAL(10,2) NOT NULL DEFAULT '5' AFTER \`maxShippingCost\`,
    ADD \`invitedByReferrerCreditUSD\` DECIMAL(20,2) NOT NULL DEFAULT '0' AFTER \`shippingPercent\`,
    ADD \`invitedByReferrerCreditIRT\` DECIMAL(20,2) NOT NULL DEFAULT '0' AFTER \`invitedByReferrerCreditUSD\`;`);

    await queryRunner.query(`ALTER TABLE \`setting\`
    ADD \`invitedByReferrerCreditTRY\` DECIMAL(20,2) NOT NULL DEFAULT '0' AFTER \`invitedByReferrerCreditIRT\`,
    ADD \`buyPercentToReferrerCreditUSD\` DECIMAL(10,2) NOT NULL DEFAULT '0' AFTER \`invitedByReferrerCreditTRY\`,
    ADD \`buyPercentToReferrerCreditIRT\` DECIMAL(10,2) NOT NULL DEFAULT '0' AFTER \`buyPercentToReferrerCreditUSD\`,
    ADD \`buyPercentToReferrerCreditTRY\` DECIMAL(10,2) NOT NULL DEFAULT '0' AFTER \`buyPercentToReferrerCreditIRT\`;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`wallet_history\` (
  \`id\` INT(11) NOT NULL AUTO_INCREMENT,
  \`customerId\` INT(11) NOT NULL,
  \`walletUSD\` DECIMAL(20,2) NOT NULL DEFAULT 0,
  \`walletIRT\` DECIMAL(20,2) NOT NULL DEFAULT 0,
  \`walletTRY\` DECIMAL(20,2) NOT NULL DEFAULT 0,
  \`relatedOrderId\` INT(11) NULL DEFAULT NULL,
  \`relatedCustomerId\` INT(11) NULL DEFAULT NULL,
  \`type\` ENUM('buy', 'invite') NOT NULL DEFAULT 'buy',
  PRIMARY KEY (\`id\`),
  INDEX \`fk_wallet_history_customer1_idx\` (\`customerId\` ASC),
  INDEX \`fk_wallet_history_customer2_idx\` (\`relatedCustomerId\` ASC),
  INDEX \`fk_wallet_history_order1_idx\` (\`relatedOrderId\` ASC),
  CONSTRAINT \`fk_wallet_history_customer1\`
    FOREIGN KEY (\`customerId\`)
    REFERENCES \`customer\` (\`id\`)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,
  CONSTRAINT \`fk_wallet_history_customer2\`
    FOREIGN KEY (\`relatedCustomerId\`)
    REFERENCES \`customer\` (\`id\`)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,
  CONSTRAINT \`fk_wallet_history_order1\`
    FOREIGN KEY (\`relatedOrderId\`)
    REFERENCES \`order\` (\`id\`)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION)
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(
      `ALTER TABLE \`wallet_history\` ADD \`createdAt\` DATETIME NOT NULL AFTER \`type\`;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    //
  }
}
