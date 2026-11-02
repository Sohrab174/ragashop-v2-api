import { Logger } from '@nestjs/common';
import { withMysqlNamedLock } from './named-lock.util';

describe('withMysqlNamedLock cleanup', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function mockConnection(opts: {
    acquire?: number;
    connectThrows?: Error;
    releaseThrows?: Error;
    getLockThrows?: Error;
    releaseLockThrows?: Error;
  }) {
    const state = { isReleased: false, releaseCalls: 0 };
    const queries: string[] = [];

    const queryRunner: any = {
      get isReleased() {
        return state.isReleased;
      },
      connect: jest.fn(async () => {
        if (opts.connectThrows) {
          throw opts.connectThrows;
        }
      }),
      query: jest.fn(async (sql: string) => {
        queries.push(String(sql));
        if (String(sql).includes('GET_LOCK')) {
          if (opts.getLockThrows) {
            throw opts.getLockThrows;
          }
          return [{ acquired: opts.acquire ?? 1 }];
        }
        if (String(sql).includes('RELEASE_LOCK')) {
          if (opts.releaseLockThrows) {
            throw opts.releaseLockThrows;
          }
          return [{ released: 1 }];
        }
        return [];
      }),
      release: jest.fn(async () => {
        state.releaseCalls += 1;
        if (opts.releaseThrows) {
          throw opts.releaseThrows;
        }
        state.isReleased = true;
      }),
    };

    return {
      connection: { createQueryRunner: () => queryRunner } as any,
      queryRunner,
      queries,
      state,
    };
  }

  it('connect() failure still attempts QueryRunner.release()', async () => {
    const { connection, queryRunner, state } = mockConnection({
      connectThrows: new Error('connect refused'),
    });

    await expect(
      withMysqlNamedLock(connection, 'lock_a', async () => 'x', 1),
    ).rejects.toThrow('connect refused');

    expect(queryRunner.release).toHaveBeenCalledTimes(1);
    expect(state.releaseCalls).toBe(1);
    expect(queryRunner.query).not.toHaveBeenCalled();
  });

  it('release() failure after successful callback preserves callback result', async () => {
    const { connection, queryRunner } = mockConnection({
      acquire: 1,
      releaseThrows: new Error('release boom'),
    });

    await expect(
      withMysqlNamedLock(connection, 'lock_b', async () => 42, 1),
    ).resolves.toBe(42);

    expect(queryRunner.release).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('QueryRunner.release failed after named lock lock_b'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('release boom'),
    );
  });

  it('release() failure after callback exception preserves original error', async () => {
    const { connection } = mockConnection({
      acquire: 1,
      releaseThrows: new Error('release boom'),
    });

    await expect(
      withMysqlNamedLock(
        connection,
        'lock_c',
        async () => {
          throw new Error('callback failed');
        },
        1,
      ),
    ).rejects.toThrow('callback failed');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('QueryRunner.release failed after named lock lock_c'),
    );
  });

  it('lock acquisition failure still cleans up QueryRunner', async () => {
    const { connection, queryRunner, queries } = mockConnection({
      acquire: 0,
    });

    await expect(
      withMysqlNamedLock(connection, 'lock_d', async () => 'x', 1),
    ).rejects.toThrow(/Unable to acquire named lock: lock_d/);

    expect(queryRunner.release).toHaveBeenCalledTimes(1);
    expect(queries.some((q) => q.includes('GET_LOCK'))).toBe(true);
    // Lock was not acquired — RELEASE_LOCK must not run.
    expect(queries.some((q) => q.includes('RELEASE_LOCK'))).toBe(false);
  });

  it('RELEASE_LOCK failure is logged and does not mask success', async () => {
    const { connection } = mockConnection({
      acquire: 1,
      releaseLockThrows: new Error('release_lock boom'),
    });

    await expect(
      withMysqlNamedLock(connection, 'lock_e', async () => 'ok', 1),
    ).resolves.toBe('ok');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('RELEASE_LOCK failed for lock_e'),
    );
  });
});
