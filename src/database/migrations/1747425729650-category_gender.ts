import { MigrationInterface, QueryRunner } from 'typeorm';

export class categoryGender1747425729650 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`category\` ADD \`gender\` ENUM('male', 'female', 'child', 'unisex') NULL DEFAULT NULL AFTER \`isSelection\`;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    //
  }
}
