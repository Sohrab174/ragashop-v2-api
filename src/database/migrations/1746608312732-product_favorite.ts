import { MigrationInterface, QueryRunner } from 'typeorm';

export class productFavorite1746608312732 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`product_favorite\` (
    \`id\` INT(11) NOT NULL AUTO_INCREMENT,
    \`customerId\` INT(11) NOT NULL,
    \`productId\` INT(11) NOT NULL,
    \`isDeleted\` TINYINT(1) NOT NULL DEFAULT 0,
    \`createdAt\` DATETIME NOT NULL,
    PRIMARY KEY (\`id\`),
    INDEX \`fk_product_favorite_product1_idx\` (\`productId\` ASC),
    INDEX \`fk_product_favorite_customer1_idx\` (\`customerId\` ASC),
    CONSTRAINT \`fk_product_favorite_product1\`
      FOREIGN KEY (\`productId\`)
      REFERENCES \`product\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION,
    CONSTRAINT \`fk_product_favorite_customer1\`
      FOREIGN KEY (\`customerId\`)
      REFERENCES \`customer\` (\`id\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION)
  ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    //
  }
}
