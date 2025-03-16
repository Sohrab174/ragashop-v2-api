import { MigrationInterface, QueryRunner } from 'typeorm';

export class someNewFields1742071951176 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`order\`
    ADD COLUMN \`firstName\` VARCHAR(45) NULL DEFAULT NULL AFTER \`finalAmount\`,
    ADD COLUMN \`lastName\` VARCHAR(45) NULL DEFAULT NULL AFTER \`firstName\`,
    ADD COLUMN \`location\` VARCHAR(45) NULL DEFAULT NULL AFTER \`address\`,
    ADD COLUMN \`addressDetails\` VARCHAR(45) NULL DEFAULT NULL AFTER \`location\`,
    ADD COLUMN \`postalCode\` VARCHAR(45) NULL DEFAULT NULL AFTER \`addressDetails\`,
    ADD COLUMN \`phone\` VARCHAR(45) NULL DEFAULT NULL AFTER \`postalCode\`,
    ADD COLUMN \`postTrackingCode\` VARCHAR(128) NULL DEFAULT NULL AFTER \`description\`,
    ADD COLUMN \`isDeleted\` TINYINT(1) NOT NULL DEFAULT 0 AFTER \`reasonRejected\`,
    CHANGE COLUMN \`status\` \`status\` ENUM('pending', 'accepted', 'rejected', 'paid', 'sent', 'delivered', 'buy_from_source', 'send_to_destination') CHARACTER SET 'utf8mb4' COLLATE 'utf8mb4_unicode_ci' NOT NULL DEFAULT 'pending' ;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`province\` (
        \`id\` INT(11) NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(128) NOT NULL,
        PRIMARY KEY (\`id\`))
      ENGINE = InnoDB
      DEFAULT CHARACTER SET = utf8mb4
      COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`city\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`provinceId\` INT(11) NOT NULL,
    \`name\` VARCHAR(128) NOT NULL,
    PRIMARY KEY (\`id\`),
    INDEX \`fk_city_province1_idx\` (\`provinceId\` ASC),
    CONSTRAINT \`fk_city_province1\`
      FOREIGN KEY (\`provinceId\`)
      REFERENCES \`province\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION)
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`address\` (
  \`id\` INT(11) NOT NULL AUTO_INCREMENT,
  \`customerId\` INT(11) NOT NULL,
  \`title\` VARCHAR(45) NOT NULL,
  \`address\` TEXT NOT NULL,
  \`details\` VARCHAR(45) NULL DEFAULT NULL,
  \`cityId\` INT(11) NULL DEFAULT NULL,
  \`location\` VARCHAR(45) NULL DEFAULT NULL,
  \`phone\` VARCHAR(45) NULL DEFAULT NULL,
  \`isDefault\` TINYINT(1) NOT NULL DEFAULT 0,
  \`isDeleted\` TINYINT(1) NOT NULL DEFAULT 0,
  \`createdAt\` DATETIME NOT NULL,
  PRIMARY KEY (\`id\`),
  INDEX \`fk_address_city1_idx\` (\`cityId\` ASC),
  INDEX \`fk_address_customer1_idx\` (\`customerId\` ASC),
  CONSTRAINT \`fk_address_city1\`
    FOREIGN KEY (\`cityId\`)
    REFERENCES \`city\` (\`id\`)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,
  CONSTRAINT \`fk_address_customer1\`
    FOREIGN KEY (\`customerId\`)
    REFERENCES \`customer\` (\`id\`)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION)
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`order_status\` (
  \`id\` INT(11) NOT NULL AUTO_INCREMENT,
  \`orderId\` INT(11) NOT NULL,
  \`userId\` INT(11) NULL DEFAULT NULL,
  \`type\` ENUM('pending', 'accepted', 'rejected', 'paid', 'sent', 'delivered', 'buy_from_source', 'send_to_destination') NOT NULL DEFAULT 'pending',
  \`description\` TEXT NULL DEFAULT NULL,
  \`createdAt\` DATETIME NOT NULL,
  PRIMARY KEY (\`id\`),
  INDEX \`fk_order_status_order1_idx\` (\`orderId\` ASC),
  CONSTRAINT \`fk_order_status_order1\`
    FOREIGN KEY (\`orderId\`)
    REFERENCES \`order\` (\`id\`)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION)
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`page\` (
    \`id\` INT(11) NOT NULL,
    \`code\` VARCHAR(45) NULL DEFAULT NULL,
    \`title\` VARCHAR(128) NOT NULL,
    \`content\` TEXT NOT NULL,
    \`isLocked\` TINYINT(1) NOT NULL DEFAULT 0,
    \`isDeleted\` TINYINT(1) NOT NULL DEFAULT 0,
    \`createdAt\` DATETIME NOT NULL,
    \`updatedAt\` DATETIME NOT NULL,
    PRIMARY KEY (\`id\`))
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`nav_menu\` (
  \`id\` INT(11) NOT NULL AUTO_INCREMENT,
  \`title\` VARCHAR(45) NOT NULL,
  \`pageId\` INT(11) NULL DEFAULT NULL,
  \`categoryId\` INT(11) NULL DEFAULT NULL,
  \`internalLink\` VARCHAR(255) NULL DEFAULT NULL,
  \`externalLink\` VARCHAR(255) NULL DEFAULT NULL,
  \`position\` ENUM('header', 'footer1', 'footer2') NOT NULL DEFAULT 'header',
  \`displayOrder\` INT(11) NOT NULL DEFAULT 1,
  \`isDeleted\` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (\`id\`),
  INDEX \`fk_nav_menu_category1_idx\` (\`categoryId\` ASC),
  INDEX \`fk_nav_menu_page1_idx\` (\`pageId\` ASC),
  CONSTRAINT \`fk_nav_menu_category1\`
    FOREIGN KEY (\`categoryId\`)
    REFERENCES \`category\` (\`id\`)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION,
  CONSTRAINT \`fk_nav_menu_page1\`
    FOREIGN KEY (\`pageId\`)
    REFERENCES \`page\` (\`id\`)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION)
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`setting\` (
  \`id\` INT(11) NOT NULL AUTO_INCREMENT,
  \`phone\` VARCHAR(128) NULL DEFAULT NULL,
  \`email\` VARCHAR(128) NULL DEFAULT NULL,
  \`address\` VARCHAR(255) NULL DEFAULT NULL,
  \`location\` VARCHAR(128) NULL DEFAULT NULL,
  \`instagram\` VARCHAR(128) NULL DEFAULT NULL,
  \`linkedin\` VARCHAR(128) NULL DEFAULT NULL,
  \`telegram\` VARCHAR(128) NULL DEFAULT NULL,
  \`twitter\` VARCHAR(128) NULL DEFAULT NULL,
  \`facebook\` VARCHAR(128) NULL DEFAULT NULL,
  \`whatsapp\` VARCHAR(128) NULL DEFAULT NULL,
  \`shippingCost\` DECIMAL(20,2) NOT NULL DEFAULT 0,
  \`vat\` DECIMAL(20,2) NOT NULL DEFAULT 0,
  \`noticeBeforeOrdering\` TEXT NULL DEFAULT NULL,
  \`minDeliveryDay\` INT(11) NOT NULL DEFAULT 10,
  \`maxDeliveryDay\` INT(11) NOT NULL DEFAULT 15,
  PRIMARY KEY (\`id\`))
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`ALTER TABLE \`page\` 
CHANGE COLUMN \`updatedAt\` \`updatedAt\` DATETIME NULL DEFAULT NULL ;`);

    await queryRunner.query(`ALTER TABLE \`address\` 
ADD COLUMN \`postalCode\` VARCHAR(45) NULL DEFAULT NULL AFTER \`phone\`;`);

    await queryRunner.query(`ALTER TABLE \`order\` 
ADD COLUMN \`cityId\` INT(11) NULL DEFAULT NULL AFTER \`phone\`,
ADD INDEX \`fk_order_city1_idx\` (\`cityId\` ASC);`);

    await queryRunner.query(`ALTER TABLE \`order\` 
ADD CONSTRAINT \`fk_order_city1\`
  FOREIGN KEY (\`cityId\`)
  REFERENCES \`city\` (\`id\`)
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;`);

    await queryRunner.query(
      `ALTER TABLE \`setting\` ADD \`tryToRial\` DECIMAL(20,2) NOT NULL DEFAULT '0' AFTER \`maxDeliveryDay\`;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    //
  }
}
