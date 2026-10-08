/**
 * Guard + runner for the LOCAL-ONLY FX review restamp.
 *
 * Marks the EXISTING local TRY→IRR rate as freshly checked so human checkout review
 * can pass the stale-FX guard. It never fetches a rate, never changes the numeric
 * rate or its source label, and touches nothing but setting.tryToRialFetchedAt.
 * The production stale-FX guard (requireFreshAuthoritativeTryToToman) is untouched.
 */

export const LOCAL_FX_RESTAMP_DATABASE = 'ragashop_local';
export const LOCAL_FX_RESTAMP_CONFIRM_FLAG = '--confirm-local';

const ALLOWED_NODE_ENVS = new Set(['development', 'local', 'test']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const ALLOWED_DB_TYPES = new Set(['', 'mysql', 'mariadb']);

/** Tables whose content must be identical before and after the restamp. */
export const LOCAL_FX_RESTAMP_PROTECTED_TABLES = [
  'order',
  'order_item',
  'order_status',
  'order_payment_finalization',
  'financial_event',
  'payment_submission',
  'payment_evidence',
  'payment_review_event',
  'product',
] as const;

export const LOCAL_FX_RESTAMP_SELECT_SQL =
  'SELECT tryToRial, tryToRialFetchedAt FROM setting WHERE id = 1';
export const LOCAL_FX_RESTAMP_UPDATE_SQL =
  'UPDATE setting SET tryToRialFetchedAt = ? WHERE id = 1 AND tryToRial = ?';

export type LocalFxRestampEnv = {
  [key: string]: string | undefined;
  NODE_ENV?: string;
  DATABASE_TYPE?: string;
  DATABASE_HOST?: string;
  DATABASE_NAME?: string;
};

/** Environment/argv gate; null means allowed. Runs before any DB connection. */
export function localFxRestampRefusal(
  env: LocalFxRestampEnv,
  argv: readonly string[],
): string | null {
  if (!argv.includes(LOCAL_FX_RESTAMP_CONFIRM_FLAG)) {
    return `missing ${LOCAL_FX_RESTAMP_CONFIRM_FLAG}`;
  }
  const nodeEnv = (env.NODE_ENV || '').trim().toLowerCase();
  if (!ALLOWED_NODE_ENVS.has(nodeEnv)) {
    return `NODE_ENV must be development/local/test (got "${
      nodeEnv || 'unset'
    }")`;
  }
  const dbType = (env.DATABASE_TYPE || '').trim().toLowerCase();
  if (!ALLOWED_DB_TYPES.has(dbType)) {
    return `DATABASE_TYPE must be mysql/mariadb (got "${dbType}")`;
  }
  const host = (env.DATABASE_HOST || '').trim().toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    return `DATABASE_HOST must be loopback (got "${host || 'unset'}")`;
  }
  if ((env.DATABASE_NAME || '').trim() !== LOCAL_FX_RESTAMP_DATABASE) {
    return `DATABASE_NAME must be exactly ${LOCAL_FX_RESTAMP_DATABASE}`;
  }
  return null;
}

export type LocalFxDbIdentity = {
  database: string | null | undefined;
  serverHostname: string | null | undefined;
};

/**
 * Positive identification of the connected server: the local review schema on
 * a MariaDB/MySQL server running on THIS machine (a loopback tunnel to a remote
 * server reports the remote hostname and is refused).
 */
export function localFxDbIdentityRefusal(
  identity: LocalFxDbIdentity,
  machineHostname: string,
): string | null {
  if (identity.database !== LOCAL_FX_RESTAMP_DATABASE) {
    return `connected database is "${identity.database}", expected ${LOCAL_FX_RESTAMP_DATABASE}`;
  }
  const server = (identity.serverHostname || '').trim().toLowerCase();
  const machine = machineHostname.trim().toLowerCase();
  if (!server || !machine || server !== machine) {
    return `database server host "${identity.serverHostname}" is not this machine ("${machineHostname}")`;
  }
  return null;
}

/** Stored decimal as returned by the driver; valid only when finite and > 0. */
export function localFxRateRefusal(rate: unknown): string | null {
  if (rate == null || (typeof rate === 'string' && rate.trim() === '')) {
    return 'no existing local rate (refusing to invent one)';
  }
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) {
    return `existing local rate "${rate}" is invalid (refusing to restamp)`;
  }
  return null;
}

/** Minimal query surface; mysql2 adapters return the rows / result header. */
export type LocalFxRestampDb = {
  query(sql: string, params?: unknown[]): Promise<any>;
};

export type LocalFxRestampReport = {
  database: string;
  serverHostname: string;
  tryToRial: string;
  previousFetchedAt: Date | null;
  newFetchedAt: Date;
  rateUnchanged: true;
  protectedTablesUnchanged: true;
  tgjuCalled: false;
};

async function checksumProtectedTables(
  db: LocalFxRestampDb,
): Promise<Record<string, string>> {
  const rows: Array<{ Table?: string; Checksum?: unknown }> = await db.query(
    `CHECKSUM TABLE ${LOCAL_FX_RESTAMP_PROTECTED_TABLES.map(
      (t) => `\`${t}\``,
    ).join(', ')}`,
  );
  const sums: Record<string, string> = {};
  for (const row of rows) sums[String(row.Table)] = String(row.Checksum);
  return sums;
}

/** datetime column has second precision; stamp a whole second so read-back is exact. */
function wholeSecond(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

/**
 * Identity check → read existing rate → single guarded UPDATE of the timestamp →
 * read back and verify. Throws (no write, or verified no drift) on any doubt.
 */
export async function runLocalFxRestamp(
  db: LocalFxRestampDb,
  options: {
    machineHostname: string;
    now?: Date;
    beforeWrite?: (current: {
      database: string;
      serverHostname: string;
      tryToRial: string;
      previousFetchedAt: Date | null;
    }) => void;
  },
): Promise<LocalFxRestampReport> {
  const [identityRow] = await db.query(
    'SELECT DATABASE() AS db, @@hostname AS serverHostname',
  );
  const identityRefusal = localFxDbIdentityRefusal(
    { database: identityRow?.db, serverHostname: identityRow?.serverHostname },
    options.machineHostname,
  );
  if (identityRefusal) throw new Error(identityRefusal);

  const [before] = await db.query(LOCAL_FX_RESTAMP_SELECT_SQL);
  if (!before) throw new Error('setting row id=1 not found');
  const rateRefusal = localFxRateRefusal(before.tryToRial);
  if (rateRefusal) throw new Error(rateRefusal);
  const previousFetchedAt = before.tryToRialFetchedAt
    ? new Date(before.tryToRialFetchedAt)
    : null;
  options.beforeWrite?.({
    database: identityRow.db,
    serverHostname: identityRow.serverHostname,
    tryToRial: String(before.tryToRial),
    previousFetchedAt,
  });

  const checksumsBefore = await checksumProtectedTables(db);
  const stampedAt = wholeSecond(options.now ?? new Date());

  let newFetchedAt: Date;
  await db.query('START TRANSACTION');
  try {
    const result = await db.query(LOCAL_FX_RESTAMP_UPDATE_SQL, [
      stampedAt,
      before.tryToRial,
    ]);
    if (result?.affectedRows !== 1) {
      throw new Error(
        `expected exactly 1 setting row updated, got ${result?.affectedRows}`,
      );
    }

    const [after] = await db.query(LOCAL_FX_RESTAMP_SELECT_SQL);
    if (String(after?.tryToRial) !== String(before.tryToRial)) {
      throw new Error(
        `rate changed during restamp: ${before.tryToRial} -> ${after?.tryToRial}`,
      );
    }
    const readBack = after?.tryToRialFetchedAt
      ? new Date(after.tryToRialFetchedAt)
      : null;
    if (!readBack || readBack.getTime() !== stampedAt.getTime()) {
      throw new Error(
        `timestamp read-back mismatch: wrote ${stampedAt.toISOString()}, read ${readBack?.toISOString()}`,
      );
    }
    newFetchedAt = readBack;
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }

  const checksumsAfter = await checksumProtectedTables(db);
  for (const table of Object.keys(checksumsBefore)) {
    if (checksumsBefore[table] !== checksumsAfter[table]) {
      throw new Error(`protected table ${table} changed during restamp`);
    }
  }

  return {
    database: identityRow.db,
    serverHostname: identityRow.serverHostname,
    tryToRial: String(before.tryToRial),
    previousFetchedAt,
    newFetchedAt,
    rateUnchanged: true,
    protectedTablesUnchanged: true,
    tgjuCalled: false,
  };
}
