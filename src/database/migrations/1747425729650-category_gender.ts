import { MigrationInterface, QueryRunner } from 'typeorm';

export class categoryGender1747425729650 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`category\` ADD \`gender\` ENUM('male', 'female', 'child', 'unisex') NULL DEFAULT NULL AFTER \`isSelection\`;`,
    );
    await queryRunner.query(
      `ALTER TABLE \`order\` CHANGE \`sourceTrackingCode\` \`sourceTrackingCode\` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE \`customer\` ADD \`isDeleted\` TINYINT(1) NOT NULL DEFAULT '0' AFTER \`status\`;`,
    );
    await queryRunner.query(
      `ALTER TABLE \`user\` ADD \`isDeleted\` TINYINT(1) NOT NULL DEFAULT '0' AFTER \`status\`;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    //
  }
}
