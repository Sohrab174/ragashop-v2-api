import { MigrationInterface, QueryRunner } from 'typeorm';

export class description1742517779644 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`product_description\` ADD \`isDeleted\` TINYINT(1) NOT NULL DEFAULT '0' AFTER \`displayOrder\`;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    //
  }
}
