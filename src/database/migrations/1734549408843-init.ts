
import { MigrationInterface, QueryRunner } from 'typeorm';

export class init1734549408843 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Independent tables
    await queryRunner.query(`
      CREATE TABLE \`category\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`sourceId\` INT NOT NULL,
        \`parentId\` INT NULL DEFAULT NULL,
        \`name\` VARCHAR(255) NOT NULL,
        \`iconPath\` VARCHAR(128) NULL DEFAULT NULL,
        \`displayOrder\` INT NULL DEFAULT NULL,
        \`isSelection\` TINYINT(1) NOT NULL DEFAULT 0,
        \`status\` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
        \`createdAt\` DATETIME NOT NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`fk_category_category1_idx\` (\`parentId\`),
        CONSTRAINT \`fk_category_category1\`
          FOREIGN KEY (\`parentId\`) REFERENCES \`category\` (\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE \`brand\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`sourceId\` INT NOT NULL,
        \`name\` VARCHAR(255) NOT NULL,
        \`isSelection\` TINYINT(1) NOT NULL DEFAULT 0,
        \`description\` TEXT NULL DEFAULT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE \`user\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
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
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE \`customer\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
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
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE \`attribute\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`sourceId\` INT NOT NULL,
        \`name\` VARCHAR(255) NOT NULL,
        \`type\` ENUM('color', 'other') NOT NULL DEFAULT 'other',
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE \`gateway\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`name\` ENUM('sep', 'bpm', 'zarinpal', 'payping', 'zibal', 'dpo-pay') NOT NULL DEFAULT 'sep',
        \`merchantId\` VARCHAR(255) NULL DEFAULT NULL,
        \`username\` VARCHAR(255) NULL DEFAULT NULL,
        \`password\` VARCHAR(255) NULL DEFAULT NULL,
        \`displayOrder\` INT NOT NULL DEFAULT 1,
        \`status\` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
        \`isDeleted\` TINYINT(4) NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE \`slider\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`type\` ENUM('photo', 'video') NOT NULL DEFAULT 'photo',
        \`pathFile\` VARCHAR(128) NOT NULL,
        \`title\` VARCHAR(128) NULL DEFAULT NULL,
        \`description\` VARCHAR(255) NULL DEFAULT NULL,
        \`url\` VARCHAR(255) NULL DEFAULT NULL,
        \`position\` ENUM('top', 'center') NOT NULL DEFAULT 'top',
        \`displayOrder\` INT NOT NULL DEFAULT 1,
        \`createdAt\` DATETIME NOT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Product is created before product_gallery.
    // coverId's FK is added after both tables exist.
    await queryRunner.query(`
      CREATE TABLE \`product\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`number\` VARCHAR(45) NULL DEFAULT NULL,
        \`categoryId\` INT NOT NULL,
        \`brandId\` INT NULL DEFAULT NULL,
        \`sourceId\` INT NULL DEFAULT NULL,
        \`sourceGroupId\` VARCHAR(128) NULL DEFAULT NULL,
        \`source\` ENUM('trendyol') NOT NULL DEFAULT 'trendyol',
        \`name\` VARCHAR(255) NOT NULL,
        \`sourceName\` VARCHAR(255) NULL DEFAULT NULL,
        \`coverId\` INT NULL DEFAULT NULL,
        \`code\` VARCHAR(45) NULL DEFAULT NULL,
        \`currency\` ENUM('USD', 'TRY', 'IRT') NOT NULL DEFAULT 'TRY',
        \`price\` DECIMAL(20,2) NOT NULL,
        \`discountedPrice\` DECIMAL(20,2) NULL DEFAULT NULL,
        \`discountPercent\` DECIMAL(10,2) NULL DEFAULT NULL,
        \`quantity\` INT NOT NULL,
        \`gender\` ENUM('male', 'female') NULL DEFAULT NULL,
        \`description\` TEXT NULL DEFAULT NULL,
        \`sourceDescription\` TEXT NULL DEFAULT NULL,
        \`displayOrder\` INT NULL DEFAULT NULL,
        \`status\` ENUM('active', 'inactive', 'draft') NOT NULL DEFAULT 'draft',
        \`lastCrawlingAt\` DATETIME NULL DEFAULT NULL,
        \`createdAt\` DATETIME NOT NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`fk_product_category1_idx\` (\`categoryId\`),
        INDEX \`fk_product_brand1_idx\` (\`brandId\`),
        INDEX \`fk_product_product_gallery1_idx\` (\`coverId\`),
        CONSTRAINT \`fk_product_category1\`
          FOREIGN KEY (\`categoryId\`) REFERENCES \`category\` (\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT \`fk_product_brand1\`
          FOREIGN KEY (\`brandId\`) REFERENCES \`brand\` (\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE \`product_gallery\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`productId\` INT NOT NULL,
        \`type\` ENUM('photo', 'video') NOT NULL DEFAULT 'photo',
        \`pathFile\` VARCHAR(128) NOT NULL,
        \`createdAt\` DATETIME NOT NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`fk_product_gallery_product1_idx\` (\`productId\`),
        CONSTRAINT \`fk_product_gallery_product1\`
          FOREIGN KEY (\`productId\`) REFERENCES \`product\` (\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Complete the circular product <-> product_gallery relationship.
    await queryRunner.query(`
      ALTER TABLE \`product\`
      ADD CONSTRAINT \`fk_product_product_gallery1\`
        FOREIGN KEY (\`coverId\`) REFERENCES \`product_gallery\` (\`id\`)
        ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    await queryRunner.query(`
      CREATE TABLE \`attribute_value\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`attributeId\` INT NOT NULL,
        \`extraValue\` VARCHAR(128) NULL DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`fk_attribute_value_attribute1_idx\` (\`attributeId\`),
        CONSTRAINT \`fk_attribute_value_attribute1\`
          FOREIGN KEY (\`attributeId\`) REFERENCES \`attribute\` (\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE \`product_attribute_value\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`productId\` INT NOT NULL,
        \`attributeValueId\` INT NOT NULL,
        \`number\` VARCHAR(45) NULL DEFAULT NULL,
        \`quantity\` INT NULL DEFAULT NULL,
        \`price\` DECIMAL(20,2) NULL DEFAULT NULL,
        \`discountedPrice\` DECIMAL(20,2) NULL DEFAULT NULL,
        \`discountPercent\` DECIMAL(10,2) NULL DEFAULT NULL,
        \`isDeleted\` TINYINT(1) NOT NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`fk_product_attribute_value_product1_idx\` (\`productId\`),
        INDEX \`fk_product_attribute_value_attribute_value1_idx\` (\`attributeValueId\`),
        CONSTRAINT \`fk_product_attribute_value_product1\`
          FOREIGN KEY (\`productId\`) REFERENCES \`product\` (\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT \`fk_product_attribute_value_attribute_value1\`
          FOREIGN KEY (\`attributeValueId\`) REFERENCES \`attribute_value\` (\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE \`order\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`number\` VARCHAR(45) NOT NULL,
        \`customerId\` INT NULL DEFAULT NULL,
        \`amount\` DECIMAL(20,2) NOT NULL,
        \`discount\` DECIMAL(10,2) NULL DEFAULT 0,
        \`shipping\` DECIMAL(20,2) NOT NULL,
        \`tax\` DECIMAL(20,2) NULL DEFAULT 0,
        \`finalAmount\` DECIMAL(20,2) NOT NULL,
        \`address\` TEXT NULL DEFAULT NULL,
        \`description\` TEXT NULL DEFAULT NULL,
        \`status\` ENUM('pending', 'accepted', 'rejected', 'paid', 'sent', 'delivered') NOT NULL DEFAULT 'pending',
        \`reasonRejected\` VARCHAR(255) NULL DEFAULT NULL,
        \`createdAt\` DATETIME NOT NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`fk_order_customer1_idx\` (\`customerId\`),
        CONSTRAINT \`fk_order_customer1\`
          FOREIGN KEY (\`customerId\`) REFERENCES \`customer\` (\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE \`transaction\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`orderId\` INT NOT NULL,
        \`customerId\` INT NOT NULL,
        \`gatewayId\` INT NOT NULL,
        \`amount\` DECIMAL(20,2) NOT NULL,
        \`referenceNumber\` VARCHAR(128) NULL DEFAULT NULL,
        \`randomToken\` VARCHAR(128) NULL DEFAULT NULL,
        \`terminalId\` VARCHAR(45) NULL DEFAULT NULL,
        \`merchantId\` VARCHAR(128) NULL DEFAULT NULL,
        \`payToken\` VARCHAR(128) NULL DEFAULT NULL,
        \`trackingCode\` VARCHAR(128) NULL DEFAULT NULL,
        \`verifyStatusNumber\` INT NULL DEFAULT NULL,
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
        INDEX \`fk_transaction_order1_idx\` (\`orderId\`),
        INDEX \`fk_transaction_customer1_idx\` (\`customerId\`),
        INDEX \`fk_transaction_gateway1_idx\` (\`gatewayId\`),
        CONSTRAINT \`fk_transaction_order1\`
          FOREIGN KEY (\`orderId\`) REFERENCES \`order\` (\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT \`fk_transaction_customer1\`
          FOREIGN KEY (\`customerId\`) REFERENCES \`customer\` (\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT \`fk_transaction_gateway1\`
          FOREIGN KEY (\`gatewayId\`) REFERENCES \`gateway\` (\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE \`order_item\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`orderId\` INT NOT NULL,
        \`productId\` INT NOT NULL,
        \`productAttributeValueId\` INT NULL DEFAULT NULL,
        \`price\` DECIMAL(20,2) NOT NULL,
        \`discountedPrice\` DECIMAL(20,2) NOT NULL DEFAULT 0.00,
        \`quantity\` INT NOT NULL DEFAULT 1,
        \`finalAmount\` DECIMAL(20,2) NOT NULL,
        \`createdAt\` DATETIME NOT NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`fk_order_item_order1_idx\` (\`orderId\`),
        INDEX \`fk_order_item_product_attribute_value1_idx\` (\`productAttributeValueId\`),
        INDEX \`fk_order_item_product1_idx\` (\`productId\`),
        CONSTRAINT \`fk_order_item_order1\`
          FOREIGN KEY (\`orderId\`) REFERENCES \`order\` (\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT \`fk_order_item_product_attribute_value1\`
          FOREIGN KEY (\`productAttributeValueId\`) REFERENCES \`product_attribute_value\` (\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT \`fk_order_item_product1\`
          FOREIGN KEY (\`productId\`) REFERENCES \`product\` (\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE \`incredible_offer\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`productId\` INT NOT NULL,
        \`productAttributeValueId\` INT NULL DEFAULT NULL,
        \`discountedPrice\` DECIMAL(20,2) NOT NULL,
        \`discountPercent\` DECIMAL(10,2) NOT NULL,
        \`fromDate\` DATETIME NOT NULL,
        \`toDate\` DATETIME NOT NULL,
        \`createdAt\` DATETIME NOT NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`fk_incredible_offer_product1_idx\` (\`productId\`),
        INDEX \`fk_incredible_offer_product_attribute_value1_idx\` (\`productAttributeValueId\`),
        CONSTRAINT \`fk_incredible_offer_product1\`
          FOREIGN KEY (\`productId\`) REFERENCES \`product\` (\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT \`fk_incredible_offer_product_attribute_value1\`
          FOREIGN KEY (\`productAttributeValueId\`) REFERENCES \`product_attribute_value\` (\`id\`)
          ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop in reverse dependency order.
    await queryRunner.query('DROP TABLE IF EXISTS `incredible_offer`');
    await queryRunner.query('DROP TABLE IF EXISTS `order_item`');
    await queryRunner.query('DROP TABLE IF EXISTS `transaction`');
    await queryRunner.query('DROP TABLE IF EXISTS `order`');
    await queryRunner.query('DROP TABLE IF EXISTS `product_attribute_value`');
    await queryRunner.query('DROP TABLE IF EXISTS `attribute_value`');

    // Break the circular dependency before dropping product/gallery.
    await queryRunner.query('ALTER TABLE `product` DROP FOREIGN KEY `fk_product_product_gallery1`');
    await queryRunner.query('DROP TABLE IF EXISTS `product_gallery`');
    await queryRunner.query('DROP TABLE IF EXISTS `product`');

    await queryRunner.query('DROP TABLE IF EXISTS `slider`');
    await queryRunner.query('DROP TABLE IF EXISTS `gateway`');
    await queryRunner.query('DROP TABLE IF EXISTS `attribute`');
    await queryRunner.query('DROP TABLE IF EXISTS `customer`');
    await queryRunner.query('DROP TABLE IF EXISTS `user`');

    // category has a self-referencing FK, so drop it after products.
    await queryRunner.query('DROP TABLE IF EXISTS `category`');
    await queryRunner.query('DROP TABLE IF EXISTS `brand`');
  }
}
