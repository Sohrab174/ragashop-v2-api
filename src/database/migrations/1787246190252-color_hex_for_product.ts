import { MigrationInterface, QueryRunner } from 'typeorm';

export class colorHexForProduct1787246190252 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
  ALTER TABLE product
  ADD COLUMN colorHex CHAR(7) NULL
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
  ALTER TABLE product
  DROP COLUMN colorHex
`);
  }
}
