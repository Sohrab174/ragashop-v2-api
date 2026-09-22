import { QueryRunner } from 'typeorm';
import { foreignKeyExists, indexExists } from './migration-utils';

describe('migration-utils foreignKeyExists', () => {
  it('uses information_schema TABLE_CONSTRAINTS, not SHOW INDEX', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT DATABASE()')) {
          return [{ db: 'ragashop_local' }];
        }
        if (sql.includes('information_schema.TABLE_CONSTRAINTS')) {
          return [];
        }
        return [];
      }),
    } as unknown as QueryRunner;

    const exists = await foreignKeyExists(
      queryRunner,
      'order',
      'fk_order_successful_transaction',
    );

    expect(exists).toBe(false);
    expect(
      queries.some((sql) =>
        sql.includes('information_schema.TABLE_CONSTRAINTS'),
      ),
    ).toBe(true);
    expect(
      queries.some((sql) => sql.includes("CONSTRAINT_TYPE = 'FOREIGN KEY'")),
    ).toBe(true);
    expect(queries.some((sql) => sql.includes('SHOW INDEX'))).toBe(false);
  });

  it('returns true when FK constraint row exists', async () => {
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT DATABASE()')) {
          return [{ db: 'ragashop_local' }];
        }
        if (sql.includes('information_schema.TABLE_CONSTRAINTS')) {
          return [{ CONSTRAINT_NAME: 'fk_order_successful_transaction' }];
        }
        return [];
      }),
    } as unknown as QueryRunner;

    await expect(
      foreignKeyExists(queryRunner, 'order', 'fk_order_successful_transaction'),
    ).resolves.toBe(true);
  });

  it('indexExists remains separate from foreignKeyExists', async () => {
    const queryRunner = {
      query: jest.fn(async () => [
        { Key_name: 'fk_order_successful_transaction_idx' },
      ]),
    } as unknown as QueryRunner;

    await expect(
      indexExists(queryRunner, 'order', 'fk_order_successful_transaction_idx'),
    ).resolves.toBe(true);

    const fkQueryRunner = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT DATABASE()')) {
          return [{ db: 'ragashop_local' }];
        }
        return [];
      }),
    } as unknown as QueryRunner;

    await expect(
      foreignKeyExists(
        fkQueryRunner,
        'order',
        'fk_order_successful_transaction',
      ),
    ).resolves.toBe(false);
  });
});
