import { QueryRunner } from 'typeorm';

export async function tableExists(
  queryRunner: QueryRunner,
  tableName: string,
): Promise<boolean> {
  const rows = await queryRunner.query(`SHOW TABLES LIKE ?`, [tableName]);
  return rows.length > 0;
}

export async function columnExists(
  queryRunner: QueryRunner,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const rows = await queryRunner.query(
    `SHOW COLUMNS FROM \`${tableName}\` LIKE ?`,
    [columnName],
  );
  return rows.length > 0;
}

export async function indexExists(
  queryRunner: QueryRunner,
  tableName: string,
  indexName: string,
): Promise<boolean> {
  const rows = await queryRunner.query(
    `SHOW INDEX FROM \`${tableName}\` WHERE Key_name = ?`,
    [indexName],
  );
  return rows.length > 0;
}

export async function foreignKeyExists(
  queryRunner: QueryRunner,
  tableName: string,
  constraintName: string,
  databaseName?: string,
): Promise<boolean> {
  const dbRows = databaseName
    ? [{ db: databaseName }]
    : await queryRunner.query(`SELECT DATABASE() AS db`);
  const schema = dbRows?.[0]?.db;
  if (!schema) {
    return false;
  }

  const rows = await queryRunner.query(
    `
      SELECT CONSTRAINT_NAME
      FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = ?
        AND CONSTRAINT_TYPE = 'FOREIGN KEY'
      LIMIT 1;
    `,
    [schema, tableName, constraintName],
  );

  return rows.length > 0;
}

export async function dropForeignKeyIfExists(
  queryRunner: QueryRunner,
  tableName: string,
  constraintName: string,
): Promise<void> {
  if (await foreignKeyExists(queryRunner, tableName, constraintName)) {
    await queryRunner.query(
      `ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${constraintName}\``,
    );
  }
}

export async function addColumnIfMissing(
  queryRunner: QueryRunner,
  tableName: string,
  columnName: string,
  ddl: string,
): Promise<void> {
  if (!(await columnExists(queryRunner, tableName, columnName))) {
    await queryRunner.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${ddl}`);
  }
}

export async function addUniqueIndexIfMissing(
  queryRunner: QueryRunner,
  tableName: string,
  indexName: string,
  columnsSql: string,
): Promise<void> {
  if (!(await indexExists(queryRunner, tableName, indexName))) {
    await queryRunner.query(
      `ALTER TABLE \`${tableName}\` ADD UNIQUE INDEX \`${indexName}\` (${columnsSql})`,
    );
  }
}

export async function addIndexIfMissing(
  queryRunner: QueryRunner,
  tableName: string,
  indexName: string,
  columnsSql: string,
): Promise<void> {
  if (!(await indexExists(queryRunner, tableName, indexName))) {
    await queryRunner.query(
      `ALTER TABLE \`${tableName}\` ADD INDEX \`${indexName}\` (${columnsSql})`,
    );
  }
}

export async function dropIndexIfExists(
  queryRunner: QueryRunner,
  tableName: string,
  indexName: string,
): Promise<void> {
  if (await indexExists(queryRunner, tableName, indexName)) {
    await queryRunner.query(
      `ALTER TABLE \`${tableName}\` DROP INDEX \`${indexName}\``,
    );
  }
}

export async function dropColumnIfExists(
  queryRunner: QueryRunner,
  tableName: string,
  columnName: string,
): Promise<void> {
  if (await columnExists(queryRunner, tableName, columnName)) {
    await queryRunner.query(
      `ALTER TABLE \`${tableName}\` DROP COLUMN \`${columnName}\``,
    );
  }
}
