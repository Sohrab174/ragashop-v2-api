import { MigrationInterface, QueryRunner } from 'typeorm';

export class alterGallery1735313847433 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`product_gallery\` ADD \`source\` ENUM('trendyol') NULL DEFAULT NULL AFTER \`type\`;`,
    );
    await queryRunner.query(
      `ALTER TABLE \`product\` ADD \`sourceUrl\` VARCHAR(255) NULL DEFAULT NULL AFTER \`sourceId\`;`,
    );

    await queryRunner.query(
      `ALTER TABLE \`product\` CHANGE \`source\` \`source\` ENUM('trendyol') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;`,
    );
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    //
  }
}
