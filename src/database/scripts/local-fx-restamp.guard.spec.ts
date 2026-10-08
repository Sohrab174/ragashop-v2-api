import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  LOCAL_FX_RESTAMP_CONFIRM_FLAG,
  LOCAL_FX_RESTAMP_PROTECTED_TABLES,
  LOCAL_FX_RESTAMP_SELECT_SQL,
  LOCAL_FX_RESTAMP_UPDATE_SQL,
  localFxDbIdentityRefusal,
  localFxRateRefusal,
  localFxRestampRefusal,
  runLocalFxRestamp,
  type LocalFxRestampDb,
} from './local-fx-restamp.guard';

const localEnv = {
  NODE_ENV: 'development',
  DATABASE_HOST: '127.0.0.1',
  DATABASE_NAME: 'ragashop_local',
};
const confirm = [LOCAL_FX_RESTAMP_CONFIRM_FLAG];
const MACHINE = 'DESKTOP-15FNDRC';

type SettingRow = {
  tryToRial: unknown;
  tryToRialFetchedAt: Date | null;
  tryToRialSource: string | null;
  changePercentTryToRial: string;
};

function fakeDb(
  row: SettingRow | null,
  opts: {
    database?: string;
    serverHostname?: string;
    mutateRateOnUpdate?: boolean;
    mutateOrdersOnUpdate?: boolean;
  } = {},
) {
  const log: string[] = [];
  const checksums: Record<string, string> = Object.fromEntries(
    LOCAL_FX_RESTAMP_PROTECTED_TABLES.map((t) => [t, `sum-${t}`]),
  );
  let snapshot: SettingRow | null = null;
  const db: LocalFxRestampDb = {
    async query(sql: string, params: unknown[] = []) {
      log.push(sql);
      if (sql.startsWith('SELECT DATABASE()')) {
        return [
          {
            db: opts.database ?? 'ragashop_local',
            serverHostname: opts.serverHostname ?? MACHINE,
          },
        ];
      }
      if (sql === LOCAL_FX_RESTAMP_SELECT_SQL) {
        return row
          ? [
              {
                tryToRial: row.tryToRial,
                tryToRialFetchedAt: row.tryToRialFetchedAt,
              },
            ]
          : [];
      }
      if (sql.startsWith('CHECKSUM TABLE')) {
        return Object.entries(checksums).map(([Table, Checksum]) => ({
          Table,
          Checksum,
        }));
      }
      if (sql === 'START TRANSACTION') {
        snapshot = row ? { ...row } : null;
        return {};
      }
      if (sql === 'COMMIT') return {};
      if (sql === 'ROLLBACK') {
        if (row && snapshot) Object.assign(row, snapshot);
        return {};
      }
      if (sql === LOCAL_FX_RESTAMP_UPDATE_SQL) {
        if (!row || row.tryToRial !== params[1]) return { affectedRows: 0 };
        row.tryToRialFetchedAt = params[0] as Date;
        if (opts.mutateRateOnUpdate) row.tryToRial = '1.00';
        if (opts.mutateOrdersOnUpdate) checksums.order = 'changed';
        return { affectedRows: 1 };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  return { db, log };
}

const staleRow = (): SettingRow => ({
  tryToRial: '50765.00',
  tryToRialFetchedAt: new Date('2026-09-29T17:17:48.000Z'),
  tryToRialSource: 'LOCAL_REVIEW_RESTAMP',
  changePercentTryToRial: '30.00',
});

const NOW = new Date('2026-09-30T19:10:05.789Z');
const writes = (log: string[]) =>
  log.filter((sql) =>
    /^\s*(UPDATE|INSERT|DELETE|REPLACE|ALTER|DROP)/i.test(sql),
  );

describe('local FX restamp — environment guard', () => {
  it('A — development + loopback + ragashop_local is allowed', () => {
    expect(localFxRestampRefusal(localEnv, confirm)).toBeNull();
    expect(
      localFxRestampRefusal(
        { ...localEnv, DATABASE_HOST: 'localhost' },
        confirm,
      ),
    ).toBeNull();
    expect(
      localFxRestampRefusal({ ...localEnv, DATABASE_HOST: '::1' }, confirm),
    ).toBeNull();
  });

  it('B — local (and test) NODE_ENV are allowed', () => {
    expect(
      localFxRestampRefusal({ ...localEnv, NODE_ENV: 'local' }, confirm),
    ).toBeNull();
    expect(
      localFxRestampRefusal({ ...localEnv, NODE_ENV: 'test' }, confirm),
    ).toBeNull();
  });

  it.each([
    ['C', 'production'],
    ['C', 'PRODUCTION'],
    ['D', 'staging'],
    ['E', undefined],
    ['E', ''],
    ['E', '   '],
    ['F', 'prod'],
    ['F', 'dev'],
    ['F', 'preview'],
    ['F', 'qa'],
  ])('%s — refuses NODE_ENV=%p', (_case, NODE_ENV) => {
    expect(localFxRestampRefusal({ ...localEnv, NODE_ENV }, confirm)).toMatch(
      /NODE_ENV/,
    );
  });

  it.each([
    '10.0.0.5',
    '192.168.1.20',
    '0.0.0.0',
    'db.ragashop.co',
    'ragashop.co',
    '127.0.0.1.example.com',
    '',
    undefined,
  ])('G — refuses non-loopback DATABASE_HOST=%p', (DATABASE_HOST) => {
    expect(
      localFxRestampRefusal({ ...localEnv, DATABASE_HOST }, confirm),
    ).toMatch(/DATABASE_HOST/);
  });

  it.each([
    'ragashop',
    'ragashop_staging',
    'ragashop_local_copy',
    '',
    undefined,
  ])('refuses DATABASE_NAME=%p', (DATABASE_NAME) => {
    expect(
      localFxRestampRefusal({ ...localEnv, DATABASE_NAME }, confirm),
    ).toMatch(/DATABASE_NAME/);
  });

  it('refuses non-MySQL database types', () => {
    expect(
      localFxRestampRefusal(
        { ...localEnv, DATABASE_TYPE: 'postgres' },
        confirm,
      ),
    ).toMatch(/DATABASE_TYPE/);
  });

  it('requires the explicit confirm flag', () => {
    expect(localFxRestampRefusal(localEnv, [])).toMatch(/confirm-local/);
  });
});

describe('local FX restamp — connected DB identity', () => {
  it('accepts ragashop_local on this machine only', () => {
    expect(
      localFxDbIdentityRefusal(
        { database: 'ragashop_local', serverHostname: 'desktop-15fndrc' },
        MACHINE,
      ),
    ).toBeNull();
  });

  it('G — refuses a loopback tunnel to another server or another schema, before any write', async () => {
    for (const opts of [
      { serverHostname: 'ragashop-prod-db-1' },
      { serverHostname: '' },
      { database: 'ragashop' },
    ]) {
      const row = staleRow();
      const { db, log } = fakeDb(row, opts);
      await expect(
        runLocalFxRestamp(db, { machineHostname: MACHINE, now: NOW }),
      ).rejects.toThrow(/database/);
      expect(writes(log)).toEqual([]);
      expect(row).toEqual(staleRow());
    }
  });
});

describe('local FX restamp — runner', () => {
  it.each([null, undefined, '', '0.00', '0', '-5.00', 'abc', 'NaN'])(
    'H — rate %p refuses with no write',
    async (tryToRial) => {
      const row = { ...staleRow(), tryToRial };
      const { db, log } = fakeDb(row);
      await expect(
        runLocalFxRestamp(db, { machineHostname: MACHINE, now: NOW }),
      ).rejects.toThrow(/rate/);
      expect(writes(log)).toEqual([]);
      expect(log).not.toContain('START TRANSACTION');
      expect(localFxRateRefusal(tryToRial)).not.toBeNull();
    },
  );

  it('H — missing setting row refuses with no write', async () => {
    const { db, log } = fakeDb(null);
    await expect(
      runLocalFxRestamp(db, { machineHostname: MACHINE, now: NOW }),
    ).rejects.toThrow(/setting row/);
    expect(writes(log)).toEqual([]);
  });

  it('I — the only write is the timestamp UPDATE; source and markup untouched', async () => {
    const row = staleRow();
    const { db, log } = fakeDb(row);
    const report = await runLocalFxRestamp(db, {
      machineHostname: MACHINE,
      now: NOW,
    });

    expect(writes(log)).toEqual([LOCAL_FX_RESTAMP_UPDATE_SQL]);
    const setClause = /SET (.*) WHERE/.exec(LOCAL_FX_RESTAMP_UPDATE_SQL);
    expect(setClause?.[1]).toBe('tryToRialFetchedAt = ?');
    expect(row.tryToRialSource).toBe('LOCAL_REVIEW_RESTAMP');
    expect(row.changePercentTryToRial).toBe('30.00');
    expect(row.tryToRialFetchedAt).toEqual(
      new Date('2026-09-30T19:10:05.000Z'),
    );
    expect(report.newFetchedAt).toEqual(new Date('2026-09-30T19:10:05.000Z'));
    expect(report.previousFetchedAt).toEqual(
      new Date('2026-09-29T17:17:48.000Z'),
    );
    expect(report.protectedTablesUnchanged).toBe(true);
    expect(report.tgjuCalled).toBe(false);
  });

  it('J — numeric rate is exactly unchanged and the UPDATE is conditional on it', async () => {
    const row = staleRow();
    const { db } = fakeDb(row);
    const report = await runLocalFxRestamp(db, {
      machineHostname: MACHINE,
      now: NOW,
    });
    expect(row.tryToRial).toBe('50765.00');
    expect(report.tryToRial).toBe('50765.00');
    expect(report.rateUnchanged).toBe(true);
    expect(LOCAL_FX_RESTAMP_UPDATE_SQL).toMatch(
      /WHERE id = 1 AND tryToRial = \?$/,
    );
    expect(LOCAL_FX_RESTAMP_UPDATE_SQL).not.toMatch(/SET[^W]*\btryToRial\s*=/);
  });

  it('reports current rate, previous timestamp and target before any write', async () => {
    const { db, log } = fakeDb(staleRow());
    const seen: unknown[] = [];
    await runLocalFxRestamp(db, {
      machineHostname: MACHINE,
      now: NOW,
      beforeWrite: (current) => seen.push({ ...current, writes: writes(log) }),
    });
    expect(seen).toEqual([
      {
        database: 'ragashop_local',
        serverHostname: MACHINE,
        tryToRial: '50765.00',
        previousFetchedAt: new Date('2026-09-29T17:17:48.000Z'),
        writes: [],
      },
    ]);

    const refused: unknown[] = [];
    const { db: badDb } = fakeDb({ ...staleRow(), tryToRial: null });
    await expect(
      runLocalFxRestamp(badDb, {
        machineHostname: MACHINE,
        beforeWrite: (c) => refused.push(c),
      }),
    ).rejects.toThrow();
    expect(refused).toEqual([]);
  });

  it('J — any rate drift during the write rolls back and fails', async () => {
    const row = staleRow();
    const { db, log } = fakeDb(row, { mutateRateOnUpdate: true });
    await expect(
      runLocalFxRestamp(db, { machineHostname: MACHINE, now: NOW }),
    ).rejects.toThrow(/rate changed/);
    expect(log).toContain('ROLLBACK');
    expect(log).not.toContain('COMMIT');
    expect(row).toEqual(staleRow());
  });

  it('orders/payments/financial events/inventory are fingerprinted before and after', async () => {
    expect([...LOCAL_FX_RESTAMP_PROTECTED_TABLES]).toEqual(
      expect.arrayContaining([
        'order',
        'order_item',
        'financial_event',
        'payment_submission',
        'order_payment_finalization',
        'product',
      ]),
    );
    const { db } = fakeDb(staleRow(), { mutateOrdersOnUpdate: true });
    await expect(
      runLocalFxRestamp(db, { machineHostname: MACHINE, now: NOW }),
    ).rejects.toThrow(/protected table order changed/);
  });
});

describe('local FX restamp — isolation from production code', () => {
  it('script never calls TGJU or writes anything but through the guarded runner', () => {
    const src = readFileSync(
      join(__dirname, 'local-fx-review-restamp.ts'),
      'utf8',
    );
    const guard = readFileSync(
      join(__dirname, 'local-fx-restamp.guard.ts'),
      'utf8',
    );
    for (const text of [src, guard]) {
      expect(text).not.toMatch(/tgju\.org|fetchTgju|getTryToRial\(|axios/i);
      expect(text).not.toMatch(
        /UPDATE\s+`?(order|financial_event|product|payment)/i,
      );
    }
    expect(src).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b/);
    expect(src).toMatch(/localFxRestampRefusal\(process\.env/);
    expect(src).toMatch(/runLocalFxRestamp\(/);
  });

  it('npm script is explicit local tooling and still needs --confirm-local', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '../../../package.json'), 'utf8'),
    );
    const scripts: Record<string, string> = pkg.scripts;
    const entries = Object.entries(scripts).filter(([, cmd]) =>
      cmd.includes('local-fx-review-restamp'),
    );
    expect(entries).toEqual([
      [
        'local:fx:restamp',
        'ts-node -r tsconfig-paths/register src/database/scripts/local-fx-review-restamp.ts',
      ],
    ]);
    for (const [name, cmd] of Object.entries(scripts)) {
      if (name === 'local:fx:restamp') continue;
      expect(cmd).not.toMatch(/local:fx:restamp|local-fx/);
    }
  });

  it('no runtime module imports the local restamp helper', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (full === __dirname) continue;
          walk(full);
        } else if (
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.spec.ts')
        ) {
          if (
            /local-fx-re(stamp|view-restamp)/.test(readFileSync(full, 'utf8'))
          ) {
            offenders.push(full);
          }
        }
      }
    };
    walk(join(__dirname, '../..'));
    expect(offenders).toEqual([]);
  });

  it('production stale-FX guard and max-age policy are unchanged', () => {
    const svc = readFileSync(
      join(__dirname, '../../modules/setting/setting.service.ts'),
      'utf8',
    );
    expect(svc).toMatch(/code: 'fx_rate_stale'/);
    expect(svc).toMatch(/ageMs <= maxAgeMs/);
    expect(svc).not.toMatch(/LOCAL_REVIEW_RESTAMP|local-fx/);
    const types = readFileSync(
      join(__dirname, '../../modules/finance/finance.types.ts'),
      'utf8',
    );
    expect(types).toMatch(/DEFAULT_FX_RATE_MAX_AGE_MS = 15 \* 60 \* 1000/);
  });
});
