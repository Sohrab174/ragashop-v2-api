import { getConnection } from 'typeorm';
import { SettingService } from './setting.service';
import { SettingEntity } from './entities/setting.entity';
import { APPROVED_SETTINGS_BOOTSTRAP_SINGLETON } from './settings-bootstrap.constants';
import { withMysqlNamedLock } from '../../utils/named-lock.util';

jest.mock('../../utils/named-lock.util', () => ({
  withMysqlNamedLock: jest.fn((_connection, _name, fn) => fn()),
}));

jest.mock('typeorm', () => {
  const actual = jest.requireActual('typeorm');
  return {
    ...actual,
    getConnection: jest.fn(),
  };
});

function mockError() {
  return {
    unprocessableEntity: jest.fn((messages, data) => {
      const err: any = new Error(messages?.[0] || 'error');
      err.data = data;
      err.status = 422;
      throw err;
    }),
  };
}

/**
 * NOTE: Concurrent serialization here uses a mocked advisory-lock mutex.
 * That proves application ordering under a held lock — it is NOT a real
 * MySQL GET_LOCK / multi-connection concurrency verification.
 */
describe('Settings one-time bootstrap', () => {
  const getConnectionMock = getConnection as unknown as jest.Mock;
  const withLockMock = withMysqlNamedLock as unknown as jest.Mock;

  function buildQueryRunner(opts: {
    count?: number | (() => number);
    saveImpl?: (entity: any) => Promise<any>;
    saveThrows?: Error;
    connectThrows?: Error;
    startTransactionThrows?: Error;
  }) {
    const state = {
      rolledBack: false,
      committed: false,
      released: false,
      saved: null as any,
      isReleased: false,
    };

    const manager = {
      count: jest.fn(async () => {
        const c = opts.count ?? 0;
        return typeof c === 'function' ? c() : c;
      }),
      create: jest.fn((_entity, data) => ({ ...data })),
      save: jest.fn(async (entity) => {
        if (opts.saveThrows) {
          throw opts.saveThrows;
        }
        if (opts.saveImpl) {
          return opts.saveImpl(entity);
        }
        state.saved = entity;
        return entity;
      }),
    };

    const queryRunner: any = {
      get isReleased() {
        return state.isReleased;
      },
      connect: jest.fn(async () => {
        if (opts.connectThrows) {
          throw opts.connectThrows;
        }
      }),
      startTransaction: jest.fn(async () => {
        if (opts.startTransactionThrows) {
          throw opts.startTransactionThrows;
        }
      }),
      commitTransaction: jest.fn().mockImplementation(async () => {
        state.committed = true;
      }),
      rollbackTransaction: jest.fn().mockImplementation(async () => {
        state.rolledBack = true;
      }),
      release: jest.fn().mockImplementation(async () => {
        state.released = true;
        state.isReleased = true;
      }),
      manager,
    };

    getConnectionMock.mockReturnValue({
      createQueryRunner: () => queryRunner,
    });

    return { queryRunner, manager, state };
  }

  function buildService(repoOverrides: Partial<any> = {}) {
    const repo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
      ...repoOverrides,
    };
    const service = new SettingService(repo as any, mockError() as any);
    return { service, repo };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SETTINGS_BOOTSTRAP_ENABLED;
    withLockMock.mockImplementation((_c, _n, fn) => fn());
  });

  it('disabled bootstrap performs no write', async () => {
    process.env.SETTINGS_BOOTSTRAP_ENABLED = 'false';
    const { service } = buildService();
    const result = await service.bootstrapApprovedSingleton();
    expect(result.outcome).toBe('skipped_disabled');
    expect(result.storefrontReady).toBe(false);
    expect(result.settingsCommitted).toBe(false);
    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(withLockMock).not.toHaveBeenCalled();
  });

  it('empty table creates exactly one approved singleton then refreshes FX', async () => {
    process.env.SETTINGS_BOOTSTRAP_ENABLED = 'true';
    const { service } = buildService();
    const { manager, state } = buildQueryRunner({ count: 0 });

    jest.spyOn(service, 'getTryToRial').mockResolvedValue(54600);
    jest.spyOn(service, 'getAuthoritativeTryToToman').mockResolvedValue({
      tryToToman: 7098,
      tryToRialRaw: 54600,
      tryToRialEffective: 70980,
      source: 'TGJU',
      fetchedAt: new Date(),
      ageMs: 1000,
      isFresh: true,
      maxAgeMs: 900000,
    });

    const result = await service.bootstrapApprovedSingleton();

    expect(result.outcome).toBe('created');
    expect(result.storefrontReady).toBe(true);
    expect(result.settingsCommitted).toBe(true);
    expect(result.fxRecoveryRequired).toBe(false);
    expect(result.settingId).toBe(1);
    expect(result.tryToRial).toBe(54600);
    expect(manager.save).toHaveBeenCalledTimes(1);
    expect(state.saved).toMatchObject({
      id: 1,
      maxShippingCost: 0,
      shippingPercent: 0,
      taxPercent: 0,
      changePercentTryToRial: 30,
      minDeliveryDay: 10,
      maxDeliveryDay: 15,
      tryToRial: 0,
      tryToRialFetchedAt: null,
      tryToRialSource: 'TGJU',
      onlineGatewayPaymentsEnabled: false,
      walletSpendEnabled: false,
      manualPaymentSubmitDeadlineHours: 24,
      manualPaymentReviewHoldHours: 48,
      manualPaymentResubmitGraceHours: 24,
    });
    expect(state.committed).toBe(true);
    expect(state.rolledBack).toBe(false);
    expect(state.released).toBe(true);
    expect(APPROVED_SETTINGS_BOOTSTRAP_SINGLETON.id).toBe(1);
  });

  it('existing row leaves data unchanged (repeated bootstrap)', async () => {
    process.env.SETTINGS_BOOTSTRAP_ENABLED = 'true';
    const { service } = buildService();
    const { manager, state } = buildQueryRunner({ count: 1 });

    const result = await service.bootstrapApprovedSingleton();

    expect(result.outcome).toBe('skipped_existing');
    expect(result.storefrontReady).toBe(false);
    expect(result.settingsCommitted).toBe(false);
    expect(result.fxRecoveryRequired).toBe(true);
    expect(manager.save).not.toHaveBeenCalled();
    expect(state.committed).toBe(false);
    expect(state.rolledBack).toBe(true);
    expect(state.released).toBe(true);
  });

  it('mocked-lock concurrent attempts do not duplicate or overwrite', async () => {
    process.env.SETTINGS_BOOTSTRAP_ENABLED = 'true';
    const { service } = buildService();

    let rows = 0;
    const saves: any[] = [];
    let chain = Promise.resolve();
    withLockMock.mockImplementation(async (_c, _n, fn) => {
      const run = chain.then(() => fn());
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    });

    buildQueryRunner({
      count: () => rows,
      saveImpl: async (entity) => {
        rows += 1;
        saves.push(entity);
        return entity;
      },
    });

    jest.spyOn(service, 'getTryToRial').mockResolvedValue(null);

    const [a, b] = await Promise.all([
      service.bootstrapApprovedSingleton(),
      service.bootstrapApprovedSingleton(),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['created', 'skipped_existing']);
    expect(saves).toHaveLength(1);
    expect(rows).toBe(1);
  });

  it('database failure rolls back and reports failed', async () => {
    process.env.SETTINGS_BOOTSTRAP_ENABLED = 'true';
    const { service } = buildService();
    const { state } = buildQueryRunner({
      count: 0,
      saveThrows: new Error('disk full'),
    });

    const result = await service.bootstrapApprovedSingleton();

    expect(result.outcome).toBe('failed');
    expect(result.settingsCommitted).toBe(false);
    expect(result.storefrontReady).toBe(false);
    expect(state.rolledBack).toBe(true);
    expect(state.committed).toBe(false);
    expect(state.released).toBe(true);
  });

  it('releases QueryRunner when connect() fails (no leak)', async () => {
    process.env.SETTINGS_BOOTSTRAP_ENABLED = 'true';
    const { service } = buildService();
    const { queryRunner, state } = buildQueryRunner({
      connectThrows: new Error('connect refused'),
    });

    const result = await service.bootstrapApprovedSingleton();

    expect(result.outcome).toBe('failed');
    expect(result.settingsCommitted).toBe(false);
    expect(result.message).toMatch(/before commit/i);
    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
    expect(state.rolledBack).toBe(false);
    expect(state.released).toBe(true);
  });

  it('releases QueryRunner when startTransaction() fails', async () => {
    process.env.SETTINGS_BOOTSTRAP_ENABLED = 'true';
    const { service } = buildService();
    const { state } = buildQueryRunner({
      startTransactionThrows: new Error('cannot start tx'),
    });

    const result = await service.bootstrapApprovedSingleton();

    expect(result.outcome).toBe('failed');
    expect(result.settingsCommitted).toBe(false);
    expect(state.rolledBack).toBe(false);
    expect(state.released).toBe(true);
  });

  it('post-commit TGJU exception keeps committed settings and requires FX recovery', async () => {
    process.env.SETTINGS_BOOTSTRAP_ENABLED = 'true';
    const { service } = buildService();
    const { state } = buildQueryRunner({ count: 0 });

    const result = await service.bootstrapApprovedSingletonLocked(async () => {
      throw new Error('tgju network down');
    });

    expect(result.outcome).toBe('created');
    expect(result.settingsCommitted).toBe(true);
    expect(result.fxRecoveryRequired).toBe(true);
    expect(result.storefrontReady).toBe(false);
    expect(result.settingId).toBe(1);
    expect(result.message).toMatch(/committed successfully/i);
    expect(result.message).toMatch(/Retrying bootstrap will skip/i);
    expect(state.committed).toBe(true);
    expect(state.rolledBack).toBe(false);
  });

  it('post-commit rate-read exception keeps committed settings', async () => {
    process.env.SETTINGS_BOOTSTRAP_ENABLED = 'true';
    const { service } = buildService();
    buildQueryRunner({ count: 0 });

    const result = await service.bootstrapApprovedSingletonLocked(
      async () => 54600,
      async () => {
        throw new Error('rate read failed');
      },
    );

    expect(result.outcome).toBe('created');
    expect(result.settingsCommitted).toBe(true);
    expect(result.fxRecoveryRequired).toBe(true);
    expect(result.storefrontReady).toBe(false);
    expect(result.tryToRial).toBe(54600);
    expect(result.message).toMatch(/Retrying bootstrap will skip/i);
  });

  it('TGJU refresh null keeps settings initialized but storefront NOT ready', async () => {
    process.env.SETTINGS_BOOTSTRAP_ENABLED = 'true';
    const { service } = buildService();
    buildQueryRunner({ count: 0 });
    jest.spyOn(service, 'getTryToRial').mockResolvedValue(null);

    const result = await service.bootstrapApprovedSingleton();

    expect(result.outcome).toBe('created');
    expect(result.settingId).toBe(1);
    expect(result.settingsCommitted).toBe(true);
    expect(result.fxRecoveryRequired).toBe(true);
    expect(result.storefrontReady).toBe(false);
    expect(result.tryToRial).toBeNull();
  });

  it('advisory-lock acquisition failure returns failed without claiming commit', async () => {
    process.env.SETTINGS_BOOTSTRAP_ENABLED = 'true';
    const { service } = buildService();
    withLockMock.mockRejectedValue(new Error('Unable to acquire named lock'));

    const result = await service.bootstrapApprovedSingleton();

    expect(result.outcome).toBe('failed');
    expect(result.settingsCommitted).toBe(false);
    expect(result.fxRecoveryRequired).toBe(false);
    expect(result.message).toMatch(/before commit/i);
  });

  it('committed bootstrap result survives lock QueryRunner.release failure', async () => {
    process.env.SETTINGS_BOOTSTRAP_ENABLED = 'true';
    const { service } = buildService();
    const committed = {
      outcome: 'created' as const,
      storefrontReady: false,
      settingId: 1,
      tryToRial: null,
      message:
        'Setting id=1 was committed successfully. FX refresh/read failed — storefront NOT ready. ' +
        'Retrying bootstrap will skip the existing row; recover FX via PUT /settings/try-to-rial (or cron).',
      settingsCommitted: true,
      fxRecoveryRequired: true,
    };
    jest
      .spyOn(service, 'bootstrapApprovedSingletonLocked')
      .mockResolvedValue(committed);

    const { withMysqlNamedLock: realWithMysqlNamedLock } = jest.requireActual(
      '../../utils/named-lock.util',
    ) as typeof import('../../utils/named-lock.util');

    withLockMock.mockImplementation((c, n, fn, t) =>
      realWithMysqlNamedLock(c, n, fn, t),
    );

    const lockQr: any = {
      isReleased: false,
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(async (sql: string) => {
        if (String(sql).includes('GET_LOCK')) {
          return [{ acquired: 1 }];
        }
        return [{ released: 1 }];
      }),
      release: jest.fn().mockRejectedValue(new Error('release after commit')),
    };
    getConnectionMock.mockReturnValue({
      createQueryRunner: () => lockQr,
    });

    const warnSpy = jest
      .spyOn(require('@nestjs/common').Logger.prototype, 'warn')
      .mockImplementation();

    const result = await service.bootstrapApprovedSingleton();

    expect(result).toEqual(committed);
    expect(result.settingsCommitted).toBe(true);
    expect(result.outcome).toBe('created');
    expect(lockQr.release).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('QueryRunner.release failed after named lock'),
    );

    warnSpy.mockRestore();
  });

  it('preserves FX zero-row UPDATE detection (affected !== 1)', async () => {
    const { service, repo } = buildService({
      findOne: jest.fn().mockResolvedValue({
        id: 1,
        tryToRial: 35000,
        changePercentTryToRial: 0,
        tryToRialFetchedAt: new Date(),
        tryToRialSource: 'TGJU',
      }),
    });
    const qb: any = {
      update: jest.fn(() => qb),
      set: jest.fn(() => qb),
      where: jest.fn(() => qb),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    repo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.fetchAndPersistTgjuTryToRial(async () => 40000);
    expect(result).toBeNull();
    expect(qb.execute).toHaveBeenCalled();
  });

  it('locked helper uses SettingEntity count gate', async () => {
    const { service } = buildService();
    const { manager } = buildQueryRunner({ count: 2 });
    const result = await service.bootstrapApprovedSingletonLocked(async () => 1);
    expect(result.outcome).toBe('skipped_existing');
    expect(manager.count).toHaveBeenCalledWith(SettingEntity);
  });
});

// Detailed named-lock cleanup coverage: named-lock.util.spec.ts
