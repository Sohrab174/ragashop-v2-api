import { MigrationInterface, QueryRunner } from 'typeorm';

export class increaaseProductGalleryPathfileLength1786398963232
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`product_gallery\`
      MODIFY COLUMN \`pathFile\` VARCHAR(512) NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`product_gallery\`
      MODIFY COLUMN \`pathFile\` VARCHAR(128) NOT NULL
    `);
  }
}
