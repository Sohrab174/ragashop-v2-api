import { MigrationInterface, QueryRunner } from 'typeorm';

export class productSizeChartUrl1741739856266 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`product\` ADD \`sizeChartUrl\` VARCHAR(255) NULL DEFAULT NULL AFTER \`color\`;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    //
  }
}
