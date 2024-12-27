import { MigrationInterface, QueryRunner } from 'typeorm';

export class init1734549408843 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;`,
    );
    await queryRunner.query(
      `SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`product\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`categoryId\` INT(11) NOT NULL,
    \`brandId\` INT(11) NULL DEFAULT NULL,
    \`sourceId\` INT(11) NULL DEFAULT NULL,
    \`sourceGroupId\` VARCHAR(128) NULL DEFAULT NULL,
    \`source\` ENUM('trendyol') NOT NULL DEFAULT 'Trendyol',
    \`name\` VARCHAR(255) NOT NULL,
    \`sourceName\` VARCHAR(255) NULL DEFAULT NULL,
    \`coverId\` INT(11) NULL DEFAULT NULL,
    \`code\` VARCHAR(45) NULL DEFAULT NULL,
    \`currency\` ENUM('USD', 'TRY', 'IRT') NOT NULL DEFAULT 'TRY',
    \`price\` DECIMAL(20,2) NOT NULL,
    \`discountedPrice\` DECIMAL(20,2) NULL DEFAULT NULL,
    \`discountPercent\` DECIMAL(10,2) NULL DEFAULT NULL,
    \`quantity\` INT(11) NOT NULL,
    \`gender\` ENUM('male', 'female') NULL DEFAULT NULL,
    \`description\` TEXT NULL DEFAULT NULL,
    \`sourceDescription\` TEXT NULL DEFAULT NULL,
    \`displayOrder\` INT(11) NULL DEFAULT NULL,
    \`status\` ENUM('active', 'inactive', 'draft') NOT NULL DEFAULT 'draft',
    \`lastCrawlingAt\` DATETIME NULL DEFAULT NULL,
    \`createdAt\` DATETIME NOT NULL,
    PRIMARY KEY (\`id\`),
    INDEX \`fk_product_category1_idx\` (\`categoryId\` ASC),
    INDEX \`fk_product_brand1_idx\` (\`brandId\` ASC),
    INDEX \`fk_product_product_gallery1_idx\` (\`coverId\` ASC),
    CONSTRAINT \`fk_product_category1\`
      FOREIGN KEY (\`categoryId\`)
      REFERENCES \`category\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION,
    CONSTRAINT \`fk_product_brand1\`
      FOREIGN KEY (\`brandId\`)
      REFERENCES \`brand\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION,
    CONSTRAINT \`fk_product_product_gallery1\`
      FOREIGN KEY (\`coverId\`)
      REFERENCES \`product_gallery\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION)
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`category\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`sourceId\` INT(11) NOT NULL,
    \`parentId\` INT(11) NULL DEFAULT NULL,
    \`name\` VARCHAR(255) NOT NULL,
    \`displayOrder\` INT(11) NULL DEFAULT NULL,
    \`isSelection\` TINYINT(1) NOT NULL DEFAULT 0,
    \`status\` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    \`createdAt\` DATETIME NOT NULL,
    PRIMARY KEY (\`id\`))
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`brand\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`sourceId\` INT(11) NOT NULL,
    \`name\` VARCHAR(255) NOT NULL,
    \`isSelection\` TINYINT(1) NOT NULL DEFAULT 0,
    \`description\` TEXT NULL DEFAULT NULL,
    PRIMARY KEY (\`id\`))
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`product_gallery\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`productId\` INT(11) NOT NULL,
    \`type\` ENUM('photo', 'video') NOT NULL DEFAULT 'photo',
    \`pathFile\` VARCHAR(128) NOT NULL,
    \`createdAt\` DATETIME NOT NULL,
    PRIMARY KEY (\`id\`),
    INDEX \`fk_product_gallery_product1_idx\` (\`productId\` ASC),
    CONSTRAINT \`fk_product_gallery_product1\`
      FOREIGN KEY (\`productId\`)
      REFERENCES \`product\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION)
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`user\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`firstName\` VARCHAR(255) NOT NULL,
    \`lastName\` VARCHAR(255) NOT NULL,
    \`mobile\` VARCHAR(45) NULL DEFAULT NULL,
    \`email\` VARCHAR(255) NOT NULL,
    \`password\` VARCHAR(128) NOT NULL,
    \`role\` ENUM('god', 'admin', 'employee') NOT NULL,
    \`randomHash\` VARCHAR(128) NULL DEFAULT NULL,
    \`expireRandomHash\` DATETIME NULL DEFAULT NULL,
    \`status\` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    \`createdAt\` DATETIME NOT NULL,
    PRIMARY KEY (\`id\`))
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`customer\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`firstName\` VARCHAR(255) NULL DEFAULT NULL,
    \`lastName\` VARCHAR(255) NULL DEFAULT NULL,
    \`mobile\` VARCHAR(45) NULL DEFAULT NULL,
    \`email\` VARCHAR(255) NULL DEFAULT NULL,
    \`password\` VARCHAR(128) NULL DEFAULT NULL,
    \`address\` TEXT NULL DEFAULT NULL,
    \`randomHash\` VARCHAR(128) NULL DEFAULT NULL,
    \`expireRandomHash\` DATETIME NULL DEFAULT NULL,
    \`status\` ENUM('active', 'inactive', 'banned') NOT NULL DEFAULT 'active',
    \`createdAt\` DATETIME NOT NULL,
    PRIMARY KEY (\`id\`))
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`attribute\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`sourceId\` INT(11) NOT NULL,
    \`name\` VARCHAR(255) NOT NULL,
    \`type\` ENUM('color', 'other') NOT NULL DEFAULT 'other',
    PRIMARY KEY (\`id\`))
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`attribute_value\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`attributeId\` INT(11) NOT NULL,
    \`extraValue\` VARCHAR(128) NULL DEFAULT NULL,
    PRIMARY KEY (\`id\`),
    INDEX \`fk_attribute_value_attribute1_idx\` (\`attributeId\` ASC),
    CONSTRAINT \`fk_attribute_value_attribute1\`
      FOREIGN KEY (\`attributeId\`)
      REFERENCES \`attribute\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION)
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`slider\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`type\` ENUM('photo', 'video') NOT NULL DEFAULT 'photo',
    \`pathFile\` VARCHAR(128) NOT NULL,
    \`title\` VARCHAR(128) NULL DEFAULT NULL,
    \`description\` TEXT NULL DEFAULT NULL,
    \`url\` VARCHAR(255) NULL DEFAULT NULL,
    \`position\` ENUM('top', 'center') NOT NULL DEFAULT 'top',
    \`displayOrder\` INT(11) NOT NULL,
    \`createdAt\` DATETIME NOT NULL,
    PRIMARY KEY (\`id\`))
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`product_attribute_value\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`productId\` INT(11) NOT NULL,
    \`attributeValueId\` INT(11) NOT NULL,
    \`number\` VARCHAR(45) NULL DEFAULT NULL,
    \`quantity\` INT(11) NULL DEFAULT NULL,
    \`price\` DECIMAL(20,2) NULL DEFAULT NULL,
    \`discountedPrice\` DECIMAL(20,2) NULL DEFAULT NULL,
    \`discountPercent\` DECIMAL(10,2) NULL DEFAULT NULL,
    \`isDeleted\` TINYINT(1) NOT NULL,
    PRIMARY KEY (\`id\`),
    INDEX \`fk_product_attribute_value_product1_idx\` (\`productId\` ASC),
    INDEX \`fk_product_attribute_value_attribute_value1_idx\` (\`attributeValueId\` ASC),
    CONSTRAINT \`fk_product_attribute_value_product1\`
      FOREIGN KEY (\`productId\`)
      REFERENCES \`product\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION,
    CONSTRAINT \`fk_product_attribute_value_attribute_value1\`
      FOREIGN KEY (\`attributeValueId\`)
      REFERENCES \`attribute_value\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION)
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`order\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`number\` VARCHAR(45) NOT NULL,
    \`customerId\` INT(11) NULL DEFAULT NULL,
    \`amount\` DECIMAL(20,2) NOT NULL,
    \`shipping\` DECIMAL(20,2) NOT NULL,
    \`tax\` DECIMAL(20,2) NULL DEFAULT NULL,
    \`finalAmount\` DECIMAL(20,2) NOT NULL,
    \`address\` TEXT NULL DEFAULT NULL,
    \`description\` TEXT NULL DEFAULT NULL,
    \`status\` ENUM('pending', 'accepted', 'rejected', 'paid', 'sent', 'delivered') NOT NULL DEFAULT 'pending',
    \`reasonRejected\` VARCHAR(255) NULL DEFAULT NULL,
    \`createdAt\` DATETIME NOT NULL,
    PRIMARY KEY (\`id\`),
    INDEX \`fk_order_customer1_idx\` (\`customerId\` ASC),
    CONSTRAINT \`fk_order_customer1\`
      FOREIGN KEY (\`customerId\`)
      REFERENCES \`customer\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION)
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`gateway\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`name\` ENUM('sep', 'bpm', 'zarinpal', 'payping', 'zibal', 'dpo-pay') NOT NULL DEFAULT 'sep',
    \`merchantId\` VARCHAR(255) NULL DEFAULT NULL,
    \`username\` VARCHAR(255) NULL DEFAULT NULL,
    \`password\` VARCHAR(255) NULL DEFAULT NULL,
    \`displayOrder\` INT(11) NOT NULL DEFAULT 1,
    \`status\` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    \`isDeleted\` TINYINT(4) NOT NULL DEFAULT 0,
    PRIMARY KEY (\`id\`))
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`transaction\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`orderId\` INT(11) NOT NULL,
    \`customerId\` INT(11) NOT NULL,
    \`gatewayId\` INT(11) NOT NULL,
    \`amount\` DECIMAL(20,2) NOT NULL,
    \`referenceNumber\` VARCHAR(128) NULL DEFAULT NULL,
    \`randomToken\` VARCHAR(128) NULL DEFAULT NULL,
    \`terminalId\` VARCHAR(45) NULL DEFAULT NULL,
    \`merchantId\` VARCHAR(128) NULL DEFAULT NULL,
    \`payToken\` VARCHAR(128) NULL DEFAULT NULL,
    \`trackingCode\` VARCHAR(128) NULL DEFAULT NULL,
    \`verifyStatusNumber\` INT(11) NULL DEFAULT NULL,
    \`verifyStatusCode\` VARCHAR(45) NULL DEFAULT NULL,
    \`maskedCardNumber\` VARCHAR(45) NULL DEFAULT NULL,
    \`hashedCardNumber\` VARCHAR(128) NULL DEFAULT NULL,
    \`reduceCardAmount\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    \`rnn\` VARCHAR(128) NULL DEFAULT NULL,
    \`paidAt\` DATETIME NULL DEFAULT NULL,
    \`message\` VARCHAR(255) NULL DEFAULT NULL,
    \`ip\` VARCHAR(45) NULL DEFAULT NULL,
    \`status\` ENUM('pending', 'paid', 'failed') NOT NULL DEFAULT 'pending',
    \`createdAt\` DATETIME NOT NULL,
    PRIMARY KEY (\`id\`),
    INDEX \`fk_transaction_order1_idx\` (\`orderId\` ASC),
    INDEX \`fk_transaction_customer1_idx\` (\`customerId\` ASC),
    INDEX \`fk_transaction_gateway1_idx\` (\`gatewayId\` ASC),
    CONSTRAINT \`fk_transaction_order1\`
      FOREIGN KEY (\`orderId\`)
      REFERENCES \`order\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION,
    CONSTRAINT \`fk_transaction_customer1\`
      FOREIGN KEY (\`customerId\`)
      REFERENCES \`customer\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION,
    CONSTRAINT \`fk_transaction_gateway1\`
      FOREIGN KEY (\`gatewayId\`)
      REFERENCES \`gateway\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION)
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`order_item\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`orderId\` INT(11) NOT NULL,
    \`productId\` INT(11) NOT NULL,
    \`productAttributeValueId\` INT(11) NULL DEFAULT NULL,
    \`price\` DECIMAL(20,2) NOT NULL,
    \`discountedPrice\` DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    \`quantity\` INT(11) NOT NULL DEFAULT 1,
    \`finalAmount\` DECIMAL(20,2) NOT NULL,
    \`createdAt\` DATETIME NOT NULL,
    PRIMARY KEY (\`id\`),
    INDEX \`fk_order_item_order1_idx\` (\`orderId\` ASC),
    CONSTRAINT \`fk_order_item_order1\`
      FOREIGN KEY (\`orderId\`)
      REFERENCES \`order\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION)
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`incredible_offer\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`productId\` INT(11) NOT NULL,
    \`productAttributeValueId\` INT(11) NULL DEFAULT NULL,
    \`discountedPrice\` DECIMAL(20,2) NOT NULL,
    \`discountPercent\` DECIMAL(10,2) NOT NULL,
    \`fromDate\` DATETIME NOT NULL,
    \`toDate\` DATETIME NOT NULL,
    \`createdAt\` DATETIME NOT NULL,
    PRIMARY KEY (\`id\`),
    INDEX \`fk_incredible_offer_product1_idx\` (\`productId\` ASC),
    CONSTRAINT \`fk_incredible_offer_product1\`
      FOREIGN KEY (\`productId\`)
      REFERENCES \`product\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION)
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`slider\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`type\` ENUM('photo', 'video') NOT NULL DEFAULT 'photo',
    \`pathFile\` VARCHAR(128) NOT NULL,
    \`title\` VARCHAR(128) NULL DEFAULT NULL,
    \`description\` VARCHAR(255) NULL DEFAULT NULL,
    \`url\` VARCHAR(255) NULL DEFAULT NULL,
    \`position\` ENUM('top', 'center') NOT NULL DEFAULT 'top',
    \`displayOrder\` INT(11) NOT NULL DEFAULT 1,
    \`createdAt\` DATETIME NOT NULL,
    PRIMARY KEY (\`id\`))
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`ALTER TABLE \`category\` 
DROP COLUMN \`parentId\`,
ADD COLUMN \`parentId\` INT(11) NULL DEFAULT NULL AFTER \`sourceId\`,
ADD INDEX \`fk_category_category1_idx\` (\`parentId\` ASC);`);

    await queryRunner.query(`ALTER TABLE \`category\` 
ADD CONSTRAINT \`fk_category_category1\`
  FOREIGN KEY (\`parentId\`)
  REFERENCES \`category\` (\`id\`)
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;`);

    await queryRunner.query(`ALTER TABLE \`incredible_offer\` 
ADD INDEX \`fk_incredible_offer_product_attribute_value1_idx\` (\`productAttributeValueId\` ASC);`);

    await queryRunner.query(`ALTER TABLE \`incredible_offer\` 
ADD CONSTRAINT \`fk_incredible_offer_product_attribute_value1\`
  FOREIGN KEY (\`productAttributeValueId\`)
  REFERENCES \`product_attribute_value\` (\`id\`)
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;`);

    await queryRunner.query(
      `ALTER TABLE \`product\` ADD \`number\` VARCHAR(45) NULL DEFAULT NULL AFTER \`id\`;`,
    );

    await queryRunner.query(`ALTER TABLE \`category\` 
      ADD COLUMN \`iconPath\` VARCHAR(128) NULL DEFAULT NULL AFTER \`name\`
    `);

    await queryRunner.query(`ALTER TABLE \`order\` 
      ADD COLUMN \`discount\` DECIMAL(10,2) NULL DEFAULT 0 AFTER \`amount\`,
      CHANGE COLUMN \`tax\` \`tax\` DECIMAL(20,2) NULL DEFAULT 0  `);

    await queryRunner.query(`ALTER TABLE \`order_item\` 
    ADD INDEX \`fk_order_item_product_attribute_value1_idx\` (\`productAttributeValueId\` ASC),
    ADD INDEX \`fk_order_item_product1_idx\` (\`productId\` ASC`);

    await queryRunner.query(`ALTER TABLE \`order_item\` 
  ADD CONSTRAINT \`fk_order_item_product_attribute_value1\`
  FOREIGN KEY (\`productAttributeValueId\`)
  REFERENCES \`product_attribute_value\` (\`id\`)
  ON DELETE NO ACTION
  ON UPDATE NO ACTION,
  ADD CONSTRAINT \`fk_order_item_product1\`
  FOREIGN KEY (\`productId\`)
  REFERENCES \`product\` (\`id\`)
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;`);

    await queryRunner.query(
      `SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=1;`,
    );
    await queryRunner.query(
      `SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=1;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    //
  }
}
