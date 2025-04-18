import { MigrationInterface, QueryRunner } from 'typeorm';

export class pageSection1744970674473 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`page_section\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`pageId\` INT(11) NOT NULL,
    \`position\` ENUM('slider', 'mini_slider', 'category', 'brand', 'incredible_offer', 'product', 'faq', 'page') NOT NULL DEFAULT 'product',
    \`displayOrder\` INT(11) NOT NULL DEFAULT 1,
    \`isPublished\` TINYINT(1) NOT NULL DEFAULT 1,
    \`isDeleted\` TINYINT(1) NOT NULL DEFAULT 0,
    \`createdAt\` DATETIME NOT NULL,
    \`updatedAt\` DATETIME NULL DEFAULT NULL,
    PRIMARY KEY (\`id\`),
    INDEX \`fk_page_section_page1_idx\` (\`pageId\` ASC),
    CONSTRAINT \`fk_page_section_page1\`
      FOREIGN KEY (\`pageId\`)
      REFERENCES \`page\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION)
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`page_section_item\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`sectionId\` INT(11) NOT NULL,
    \`primaryContent\` TEXT NULL DEFAULT NULL,
    \`secondaryContent\` TEXT NULL DEFAULT NULL,
    \`buttonContent\` VARCHAR(128) NULL DEFAULT NULL,
    \`link\` TEXT NULL DEFAULT NULL,
    \`linkType\` VARCHAR(45) NULL DEFAULT NULL,
    \`filePath\` VARCHAR(128) NULL DEFAULT NULL,
    \`categoryId\` INT(11) NULL DEFAULT NULL,
    \`pageId\` INT(11) NULL DEFAULT NULL,
    \`brandId\` INT(11) NULL DEFAULT NULL,
    \`incredibleOfferId\` INT(11) NULL DEFAULT NULL,
    \`type\` VARCHAR(45) NULL DEFAULT NULL,
    \`displayOrder\` TINYINT(1) NOT NULL DEFAULT 1,
    \`isDeleted\` TINYINT(1) NOT NULL DEFAULT 0,
    \`createdAt\` DATETIME NOT NULL,
    \`updatedAt\` DATETIME NULL DEFAULT NULL,
    PRIMARY KEY (\`id\`),
    INDEX \`fk_page_section_item_page_section1_idx\` (\`sectionId\` ASC),
    INDEX \`fk_page_section_item_category1_idx\` (\`categoryId\` ASC),
    INDEX \`fk_page_section_item_page1_idx\` (\`pageId\` ASC),
    INDEX \`fk_page_section_item_brand1_idx\` (\`brandId\` ASC),
    INDEX \`fk_page_section_item_incredible_offer1_idx\` (\`incredibleOfferId\` ASC),
    CONSTRAINT \`fk_page_section_item_page_section1\`
      FOREIGN KEY (\`sectionId\`)
      REFERENCES \`page_section\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION,
    CONSTRAINT \`fk_page_section_item_category1\`
      FOREIGN KEY (\`categoryId\`)
      REFERENCES \`category\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION,
    CONSTRAINT \`fk_page_section_item_page1\`
      FOREIGN KEY (\`pageId\`)
      REFERENCES \`page\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION,
    CONSTRAINT \`fk_page_section_item_brand1\`
      FOREIGN KEY (\`brandId\`)
      REFERENCES \`brand\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION,
    CONSTRAINT \`fk_page_section_item_incredible_offer1\`
      FOREIGN KEY (\`incredibleOfferId\`)
      REFERENCES \`incredible_offer\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION)
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(`ALTER TABLE \`page_section_item\` 
ADD COLUMN \`productId\` INT(11) NULL DEFAULT NULL AFTER \`filePath\`,
ADD INDEX \`fk_page_section_item_product1_idx\` (\`productId\` ASC);`);

    await queryRunner.query(`ALTER TABLE \`page_section_item\` 
ADD CONSTRAINT \`fk_page_section_item_product1\`
  FOREIGN KEY (\`productId\`)
  REFERENCES \`product\` (\`id\`)
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;`);

    await queryRunner.query(
      `ALTER TABLE \`page_section_item\` CHANGE \`displayOrder\` \`displayOrder\` INT(11) NOT NULL DEFAULT '1';`,
    );

    await queryRunner.query(
      `ALTER TABLE \`page\` CHANGE \`content\` \`content\` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;`,
    );

    await queryRunner.query(
      `ALTER TABLE \`page_section\` ADD \`primaryContent\` TEXT NULL DEFAULT NULL AFTER \`position\`;`,
    );

    // ------------------------------
    await queryRunner.query(
      `SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;`,
    );
    await queryRunner.query(
      `SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;`,
    );
    await queryRunner.query(
      `SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';`,
    );

    await queryRunner.query(
      `ALTER TABLE \`page\` CHANGE COLUMN \`id\` \`id\` INT(11) NOT NULL AUTO_INCREMENT ;`,
    );

    await queryRunner.query(`SET SQL_MODE=@OLD_SQL_MODE;`);
    await queryRunner.query(`SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;`);
    await queryRunner.query(`SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    //
  }
}
