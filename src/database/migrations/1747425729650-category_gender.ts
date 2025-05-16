import { MigrationInterface, QueryRunner } from 'typeorm';

export class categoryGender1747425729650 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`category\` ADD \`gender\` ENUM('male', 'female', 'child', 'unisex') NULL DEFAULT NULL AFTER \`isSelection\`;`,
    );
    await queryRunner.query(
      `ALTER TABLE \`order\` CHANGE \`sourceTrackingCode\` \`sourceTrackingCode\` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    //
  }
}
