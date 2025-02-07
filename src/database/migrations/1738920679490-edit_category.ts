import { MigrationInterface, QueryRunner } from 'typeorm';

export class editCategory1738920679490 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`category\` CHANGE \`sourceId\` \`sourceId\` INT NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    //
  }
}
