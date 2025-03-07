import { MigrationInterface, QueryRunner } from 'typeorm';

export class someChanges1740187501116 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`attribute\` ADD \`source\` VARCHAR(128) NULL DEFAULT NULL AFTER \`id\`;`,
    );
    await queryRunner.query(
      `ALTER TABLE \`attribute\` CHANGE \`sourceId\` \`sourceId\` VARCHAR(128) NOT NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE \`attribute\` ADD \`sourceName\` VARCHAR(128) NULL DEFAULT NULL AFTER \`sourceId\`;`,
    );

    await queryRunner.query(`ALTER TABLE \`attribute_value\` ADD \`source\` VARCHAR(128) NULL DEFAULT NULL AFTER \`attributeId\`,
ADD \`sourceId\` VARCHAR(128) NULL DEFAULT NULL AFTER \`source\`,
ADD \`sourceName\` VARCHAR(128) NULL DEFAULT NULL AFTER \`sourceId\`,
ADD \`name\` VARCHAR(128) NOT NULL AFTER \`sourceName\`;`);

    await queryRunner.query(
      `ALTER TABLE \`product_attribute_value\` ADD \`source\` VARCHAR(128) NULL DEFAULT NULL AFTER \`id\`;`,
    );
    await queryRunner.query(`ALTER TABLE \`product_attribute_value\` ADD \`starred\` TINYINT(1) NOT NULL DEFAULT '0' AFTER \`discountPercent\`,
ADD \`sourceDescription\` TEXT NULL DEFAULT NULL AFTER \`starred\`,
ADD \`description\` TEXT NULL DEFAULT NULL AFTER \`sourceDescription\`;`);

    await queryRunner.query(
      `ALTER TABLE \`brand\` CHANGE \`sourceId\` \`sourceId\` VARCHAR(128) NULL DEFAULT NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE \`brand\` ADD \`sourceName\` VARCHAR(128) NULL DEFAULT NULL AFTER \`sourceId\`;`,
    );
    await queryRunner.query(
      `ALTER TABLE \`brand\` ADD \`isVirtual\` TINYINT(1) NOT NULL DEFAULT '0' AFTER \`isSelection\`;`,
    );
    await queryRunner.query(
      `ALTER TABLE \`brand\` ADD \`source\` VARCHAR(128) NULL DEFAULT NULL AFTER \`id\`;`,
    );

    await queryRunner.query(
      `ALTER TABLE \`category\` CHANGE \`sourceId\` \`sourceId\` VARCHAR(128) NULL DEFAULT NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE \`category\` ADD \`sourceName\` VARCHAR(128) NULL DEFAULT NULL AFTER \`parentId\`;`,
    );
    await queryRunner.query(`ALTER TABLE \`category\` ADD \`hierarchy\` VARCHAR(255) NULL DEFAULT NULL AFTER \`iconPath\`,
ADD \`bankTypeId\` VARCHAR(128) NULL DEFAULT NULL AFTER \`hierarchy\`,
ADD \`bankTypeName\` VARCHAR(128) NULL DEFAULT NULL AFTER \`bankTypeId\`;`);

    await queryRunner.query(
      `ALTER TABLE \`product\` CHANGE \`source\` \`source\` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE \`product\` CHANGE \`sourceId\` \`sourceId\` VARCHAR(128) NULL DEFAULT NULL;`,
    );
    await queryRunner.query(`ALTER TABLE \`product\` ADD \`color\` VARCHAR(128) NULL DEFAULT NULL AFTER \`sourceDescription\`,
ADD \`isVasEnabled\` TINYINT(1) NOT NULL DEFAULT '0' AFTER \`color\`,
ADD \`tax\` DECIMAL(10,2) NULL DEFAULT NULL AFTER \`isVasEnabled\`,
ADD \`isSellable\` TINYINT(1) NOT NULL DEFAULT '1' AFTER \`tax\`,
ADD \`isBasketDiscount\` TINYINT(1) NOT NULL DEFAULT '0' AFTER \`isSellable\`,
ADD \`hasStock\` TINYINT(1) NOT NULL DEFAULT '1' AFTER \`isBasketDiscount\`,
ADD \`isFreeCargo\` TINYINT(1) NOT NULL DEFAULT '0' AFTER \`hasStock\`,
ADD \`favoriteCount\` INT NOT NULL DEFAULT '0' AFTER \`isFreeCargo\`,
ADD \`uxLayout\` VARCHAR(128) NULL DEFAULT NULL AFTER \`favoriteCount\`,
ADD \`isDigitalGood\` TINYINT(1) NOT NULL DEFAULT '0' AFTER \`uxLayout\`,
ADD \`isArtWork\` TINYINT(1) NOT NULL DEFAULT '0' AFTER \`isDigitalGood\`;`);

    await queryRunner.query(
      `ALTER TABLE \`product_gallery\` CHANGE \`source\` \`source\` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`product_description\` (
  \`id\` INT(11) NOT NULL AUTO_INCREMENT,
  \`productId\` INT(11) NOT NULL,
  \`source\` VARCHAR(128) NULL DEFAULT NULL,
  \`sourceContent\` TEXT NULL DEFAULT NULL,
  \`content\` TEXT NULL DEFAULT NULL,
  \`displayOrder\` INT(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (\`id\`),
  INDEX \`fk_product_description_product1_idx\` (\`productId\` ASC),
  CONSTRAINT \`fk_product_description_product1\`
    FOREIGN KEY (\`productId\`)
    REFERENCES \`product\` (\`id\`)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION)
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_unicode_ci;`);

    await queryRunner.query(
      `ALTER TABLE \`category\` ADD \`source\` VARCHAR(128) NULL DEFAULT NULL AFTER \`id\`;`,
    );

    await queryRunner.query(
      `ALTER TABLE \`product\` ADD \`isDeleted\` TINYINT(1) NOT NULL DEFAULT '0' AFTER \`lastCrawlingAt\``,
    );

    await queryRunner.query(
      `ALTER TABLE \`product\` ADD INDEX(\`sourceGroupId\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    //
  }
}
