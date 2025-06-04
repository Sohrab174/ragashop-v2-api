import { MigrationInterface, QueryRunner } from 'typeorm';

export class pageSection1749062987371 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`page_section\`
        ADD \`onlyDiscountedProduct\` TINYINT(1) NOT NULL DEFAULT '0' AFTER \`productGender\`,
        ADD \`backgroundColor\` VARCHAR(45) NULL DEFAULT NULL AFTER \`onlyDiscountedProduct\`;`);

    await queryRunner.query(
      `ALTER TABLE \`page_section\` ADD \`timerToDate\` DATETIME NULL DEFAULT NULL AFTER \`backgroundColor\`;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    //
  }
}
