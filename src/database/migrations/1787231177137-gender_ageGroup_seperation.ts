import { MigrationInterface, QueryRunner } from 'typeorm';

export class genderAgeGroupSeperation1787231177137
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add the new ageGroup column
    await queryRunner.query(`
      ALTER TABLE product
      ADD COLUMN ageGroup ENUM('adult', 'child', 'baby')
      NULL
    `);

    // 2. Set adult for existing male/female/unisex products
    await queryRunner.query(`
      UPDATE product
      SET ageGroup = 'adult'
      WHERE gender IN ('male', 'female', 'unisex')
    `);

    // 3. Move existing child products to ageGroup
    await queryRunner.query(`
      UPDATE product
      SET ageGroup = 'child'
      WHERE gender = 'child'
    `);

    // 4. Temporarily keep "child" in the gender enum
    //    so MySQL can safely modify the column
    await queryRunner.query(`
      ALTER TABLE product
      MODIFY COLUMN gender ENUM('male', 'female', 'child', 'unisex')
      NULL
    `);

    // 5. Remove child from gender
    await queryRunner.query(`
      UPDATE product
      SET gender = NULL
      WHERE gender = 'child'
    `);

    // 6. Change gender enum to the new values
    await queryRunner.query(`
      ALTER TABLE product
      MODIFY COLUMN gender ENUM('male', 'female', 'unisex')
      NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Restore "child" to the gender enum
    await queryRunner.query(`
      ALTER TABLE product
      MODIFY COLUMN gender ENUM('male', 'female', 'child', 'unisex')
      NULL
    `);

    // 2. Convert child ageGroup back to gender
    await queryRunner.query(`
      UPDATE product
      SET gender = 'child'
      WHERE ageGroup = 'child'
    `);

    // 3. Remove ageGroup
    await queryRunner.query(`
      ALTER TABLE product
      DROP COLUMN ageGroup
    `);
  }
}
