import { MigrationInterface, QueryRunner } from 'typeorm';

export class addNewFieldsInProductTable1739733265492
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`product\` ADD \`star\` DECIMAL(10,2) NOT NULL DEFAULT
 '0' AFTER \`gender\`, ADD 
\`starCountPerson\`
 INT NOT NULL DEFAULT '0' AFTER \`star\`;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    //
  }
}
