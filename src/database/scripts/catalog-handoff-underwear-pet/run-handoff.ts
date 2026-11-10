/**
 * Fail-closed atomic runner for underwear mapping + Pet Shop curation handoff.
 *
 * Modes:
 *   preflight          — read-only strict checks (exit 1 on any failure)
 *   validate-local     — transactional apply+restore proof; ALWAYS ROLLBACK (no durable write)
 *   apply              — snapshot (mode=apply) + mutate + COMMIT (requires backup + approval)
 *   rollback           — exact-state restore from apply snapshot only (SHA256 required)
 *   shoe-preflight     — per-sourceId shoe readiness (needs_fix | already_correct | FAIL)
 *
 * NEVER auto-run against Production. NEVER enable ASSORTMENT_DISCOVERY_ENFORCEMENT.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as mysql from 'mysql2/promise';
import {
  ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV,
  isAssortmentDiscoveryEnforcementEnabled,
} from '../../../modules/catalog/assortment-policy/assortment-enforcement';
import {
  APPROVED_PET_SOURCE_IDS,
  assertNoApprovedProtectedOverlap,
  BABET_SOURCE_ID,
  BALLERINA_SOURCE_ID,
  DOG_COLLARS_SOURCE_ID,
  KOMBINEZON_HIERARCHY,
  KOMBINEZON_SOURCE_ID,
  KOMBINEZON_SOURCE_NAME,
  PET_HIERARCHY_PREFIX,
  PROTECTED_PET_SOURCE_IDS,
  PROVIDER,
  REJECTED_PET_SOURCE_ID,
  REQUIRED_COLUMNS,
  REQUIRED_TABLES,
  SHOE_ROOT_SOURCE_ID,
  SHOE_SOURCE_IDS,
} from './manifest';

type Mode =
  | 'preflight'
  | 'validate-local'
  | 'apply'
  | 'rollback'
  | 'reconcile-rollback'
  | 'shoe-preflight';

type MappingSnap = {
  id: number;
  source: string;
  sourceCategoryId: number;
  canonicalCategoryId: number;
  genderSlice: string;
  status: string;
  note: string | null;
  updatedAt: string | null;
  catSourceId: string;
  canonicalName: string;
};

type ProductSnap = {
  id: number;
  sourceId: string;
  categoryId: number;
  isCuratedExternalCatalog: number;
  categorySourceId: string | null;
  hierarchy: string | null;
  role: 'approved' | 'protected';
};

type ServerIdentity = {
  hostname: string;
  port: number;
  /** MySQL server_uuid when available; null on some MariaDB builds. */
  serverUuid: string | null;
  /** Stable instance fingerprint: hostname|port|datadir|version (always required). */
  fingerprint: string;
  datadir: string;
  version: string;
};

type PostApplyProduct = {
  id: number;
  source: string;
  sourceId: string;
  categoryId: number;
  categorySourceId: string | null;
  isCuratedExternalCatalog: 0 | 1;
};

type PostApplyExpectation = {
  mappingId: number;
  /** Denormalized mapping.source (must match category.source). */
  mappingSource: string;
  sourceCategoryId: number;
  canonicalCategoryId: number;
  genderSlice: string;
  catSource: string;
  catSourceId: string;
  mappingStatus: string;
  mappingNote: string | null;
  approved: PostApplyProduct[];
  protected: PostApplyProduct[];
};

export type ApprovedProductRow = {
  id: number;
  sourceId: string;
  categoryId: number;
  isCuratedExternalCatalog: number;
  hierarchy: string | null;
};

type ShowcasePreflightSummary = {
  approvedCount: number;
  eligibleCount: number;
  missingCount: number;
  skippedCount: number;
  eligibleSourceIds: string[];
  missingSourceIds: string[];
  skippedSourceIds: string[];
  blockingConditions: string[];
};

type ProtectedPreflightSummary = {
  protectedCount: number;
  presentCount: number;
  missingCount: number;
  skippedCount: number;
  presentSourceIds: string[];
  missingSourceIds: string[];
  skippedSourceIds: string[];
  blockingConditions: string[];
};

type HandoffPreflightResult = {
  mappingId: number | null;
  womenCanonicalId: number | null;
  showcase: ShowcasePreflightSummary;
  protectedProducts: ProtectedPreflightSummary;
  rejected: { sourceId: string; status: 'present' | 'missing' };
  blockingConditions: string[];
};

/**
 * Independently verifiable restore evidence produced by the authorized server
 * operator after a real restore test on a scratch DB. A self-declared YES is
 * never sufficient on its own.
 */
type RestoreEvidence = {
  schemaVersion: 1;
  executionId: string;
  approvedDatabaseName: string;
  serverFingerprint: string;
  backupPath: string;
  backupSha256: string;
  scratchDatabaseName: string;
  verifiedAt: string;
  verifiedBy: string;
  /** Stable ordered checks from the restore-verify procedure. */
  tableRowCounts: {
    source_category_mapping: number;
    product: number;
    category: number;
  };
  /** SHA256 of the canonical evidence payload (see buildRestoreEvidencePayload). */
  evidencePayloadSha256: string;
};

type BackupAttestation = {
  executionId: string;
  approvedDatabaseName: string;
  serverFingerprint: string;
  backupPath: string;
  backupSha256: string;
  backupCreatedAt: string;
  /** Path to RestoreEvidence JSON produced after real scratch restore. */
  restoreEvidencePath: string;
  restoreEvidenceSha256: string;
};

/** Only mode=apply snapshots are rollback-eligible. schemaVersion 3+. */
type Snapshot = {
  schemaVersion: 3;
  executionId: string;
  createdAt: string;
  mode: 'apply';
  database: string;
  approvedDatabaseName: string;
  server: ServerIdentity;
  backupPath: string;
  backupSha256: string;
  backupAttestation: BackupAttestation;
  mappingPre: MappingSnap;
  approvedProductsPre: ProductSnap[];
  protectedProductsPre: ProductSnap[];
  postApply: PostApplyExpectation;
  lifecycle: {
    status: 'ready_for_rollback' | 'rolled_back';
    rolledBackAt: string | null;
  };
};

type RollbackIntent = {
  schemaVersion: 1;
  executionId: string;
  snapshotPath: string;
  snapshotSha256: string;
  database: string;
  serverFingerprint: string;
  phase: 'pre_commit' | 'committed' | 'complete';
  updatedAt: string;
  postApply: PostApplyExpectation;
  mappingPre: MappingSnap;
  approvedProductsPre: ProductSnap[];
  protectedProductsPre: ProductSnap[];
};

class FailClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FailClosedError';
  }
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function meaningfulEnv(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed === '' ? null : trimmed;
}

function parseDotEnvFile(envPath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

/**
 * Resolve effective env for enforcement/DB:
 * - Whitespace-only process.env values are treated as absent (cannot mask .env).
 * - Meaningful process vs .env conflicts → hard failure.
 * - Trimmed values are what the API-style helpers see.
 */
function loadEffectiveEnv(): Record<string, string> {
  const envPath = path.join(__dirname, '../../../../.env');
  const fromFile = parseDotEnvFile(envPath);
  const keys = new Set([
    ...Object.keys(process.env as Record<string, string>),
    ...Object.keys(fromFile),
  ]);
  const env: Record<string, string> = {};
  for (const key of keys) {
    const proc = meaningfulEnv((process.env as Record<string, string>)[key]);
    const file = meaningfulEnv(fromFile[key]);
    if (proc != null && file != null && proc !== file) {
      throw new FailClosedError(
        `conflicting env for ${key}: process='${proc}' vs .env='${file}' — refuse`,
      );
    }
    const chosen = proc ?? file;
    if (chosen != null) env[key] = chosen;
  }
  return env;
}

/**
 * Same authority as the API: enabled iff effective value === '1'.
 * Verified OFF: key absent / whitespace-only after resolution.
 * Any other token is ambiguous and refuses (especially write modes).
 */
function requireEnforcementOffVerified(effectiveEnv: Record<string, string>): void {
  const normalized = meaningfulEnv(effectiveEnv[ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV]);

  // Mirror API helper against trimmed map
  const probe: Record<string, string> = { ...effectiveEnv };
  if (normalized == null) delete probe[ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV];
  else probe[ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV] = normalized;

  if (isAssortmentDiscoveryEnforcementEnabled(probe)) {
    throw new FailClosedError(
      `${ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV}=1 (effective) — refuse while discovery enforcement is enabled`,
    );
  }
  if (normalized != null) {
    throw new FailClosedError(
      `${ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV} effective value is ambiguous ('${normalized}'). ` +
        `Must be unset/empty (OFF) or exactly '1' (ON). Refusing execution.`,
    );
  }
}

function requireEnforcementOffForWrites(
  effectiveEnv: Record<string, string>,
  mode: Mode,
): void {
  if (mode === 'apply' || mode === 'rollback' || mode === 'reconcile-rollback') {
    requireEnforcementOffVerified(effectiveEnv);
  }
}

function placeholders(n: number): string {
  return Array(n).fill('?').join(',');
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Text(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function defaultSnapshotDir(): string {
  return path.join(__dirname, '../../../../../audit/handoff-snapshots');
}

function lifecyclePath(snapshotFile: string): string {
  return `${snapshotFile}.lifecycle.json`;
}

function rollbackIntentPath(snapshotFile: string): string {
  return `${snapshotFile}.rollback-intent.json`;
}

function notesEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = a == null || a === '' ? null : String(a);
  const nb = b == null || b === '' ? null : String(b);
  return na === nb;
}

async function connect(env: Record<string, string>) {
  const conn = await mysql.createConnection({
    host: env.DATABASE_HOST || '127.0.0.1',
    port: Number(env.DATABASE_PORT || 3306),
    user: env.DATABASE_USERNAME || 'root',
    password: env.DATABASE_PASSWORD || '',
    database: env.DATABASE_NAME || undefined,
    multipleStatements: false,
    charset: 'utf8mb4',
  });
  // Session flags only — no DDL (DDL would implicit-commit).
  await conn.query(
    "SET SESSION sql_mode = CONCAT(@@sql_mode, ',STRICT_TRANS_TABLES')",
  );
  return conn;
}

type Q = (sql: string, params?: unknown[]) => Promise<any[]>;

function makeQ(conn: mysql.Connection): Q {
  return async (sql, params = []) => {
    const [rows] = await conn.query(sql, params);
    return rows as any[];
  };
}

async function requireDbIdentity(
  q: Q,
  approvedDatabaseName: string | undefined,
): Promise<string> {
  if (!approvedDatabaseName || !approvedDatabaseName.trim()) {
    throw new FailClosedError(
      'missing --approved-database-name=<exact DATABASE()> (operator-approved)',
    );
  }
  const approved = approvedDatabaseName.trim();
  if (!/^[A-Za-z0-9_]+$/.test(approved)) {
    throw new FailClosedError(`invalid approved database name: ${approved}`);
  }
  const rows = await q('SELECT DATABASE() AS db');
  const actual = String(rows[0]?.db || '');
  if (!actual) {
    throw new FailClosedError('DATABASE() returned empty — no schema selected');
  }
  if (actual !== approved) {
    throw new FailClosedError(
      `database identity mismatch: connected=${actual} approved=${approved}`,
    );
  }
  return actual;
}

async function readServerIdentity(q: Q): Promise<ServerIdentity> {
  const meta = await q(
    `SELECT @@hostname AS hostname,
            @@port AS port,
            @@version AS version,
            @@datadir AS datadir`,
  );
  const hostname = String(meta[0]?.hostname || '').trim();
  const port = Number(meta[0]?.port);
  const version = String(meta[0]?.version || '').trim();
  const datadir = String(meta[0]?.datadir || '').trim();
  if (!hostname || !Number.isFinite(port) || !version || !datadir) {
    throw new FailClosedError(
      'cannot verify server identity (hostname/port/datadir/version incomplete) — refuse execution',
    );
  }
  let serverUuid: string | null = null;
  try {
    const uuidRows = await q(
      `SHOW VARIABLES WHERE Variable_name = 'server_uuid'`,
    );
    if (uuidRows[0]?.Value) serverUuid = String(uuidRows[0].Value).trim();
  } catch {
    serverUuid = null;
  }
  // Prefer uuid in the verified identity when MySQL exposes it; MariaDB keeps strict datadir fingerprint.
  const fingerprint = serverUuid
    ? `${hostname}|${port}|${datadir}|${version}|uuid:${serverUuid}`
    : `${hostname}|${port}|${datadir}|${version}`;
  return { hostname, port, serverUuid, fingerprint, datadir, version };
}

async function requireInnoDbForMutatedTables(q: Q): Promise<void> {
  const mutated = ['source_category_mapping', 'product'] as const;
  for (const table of mutated) {
    const rows = await q(
      `SELECT ENGINE AS engine FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [table],
    );
    if (rows.length !== 1) {
      throw new FailClosedError(`cannot read ENGINE for ${table}`);
    }
    const engine = String(rows[0].engine || '').toUpperCase();
    if (engine !== 'INNODB') {
      throw new FailClosedError(
        `table ${table} ENGINE=${engine} is nontransactional/unsupported — refuse (require InnoDB)`,
      );
    }
  }
}

async function requireSchema(q: Q): Promise<void> {
  for (const table of REQUIRED_TABLES) {
    const t = await q(
      `SELECT COUNT(*) AS n FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [table],
    );
    if (Number(t[0].n) !== 1) {
      throw new FailClosedError(`required table missing: ${table}`);
    }
  }
  for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
    for (const col of cols) {
      const c = await q(
        `SELECT COUNT(*) AS n FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
        [table, col],
      );
      if (Number(c[0].n) !== 1) {
        throw new FailClosedError(`required column missing: ${table}.${col}`);
      }
    }
  }
  const uniq = await q(
    `SELECT COUNT(*) AS n FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'source_category_mapping'
       AND non_unique = 0
       AND index_name = 'uq_scm_source_category_gender_slice'`,
  );
  if (Number(uniq[0].n) < 1) {
    throw new FailClosedError(
      'missing unique index uq_scm_source_category_gender_slice on source_category_mapping',
    );
  }
  await requireInnoDbForMutatedTables(q);
}

/** Summarize the showcase set without treating absent products as handoff failures. */
export function summarizeApprovedShowcaseRows(
  rows: ApprovedProductRow[],
): ShowcasePreflightSummary {
  const grouped = new Map<string, ApprovedProductRow[]>();
  for (const row of rows) {
    const sourceId = String(row.sourceId);
    const group = grouped.get(sourceId) || [];
    group.push(row);
    grouped.set(sourceId, group);
  }

  const eligibleSourceIds: string[] = [];
  const missingSourceIds: string[] = [];
  const blockingConditions: string[] = [];
  for (const sourceId of APPROVED_PET_SOURCE_IDS) {
    const products = grouped.get(sourceId) || [];
    if (products.length === 0) {
      missingSourceIds.push(sourceId);
      continue;
    }
    if (products.length !== 1) {
      blockingConditions.push(
        `approved sourceId=${sourceId}: duplicate active product rows=${products.length}`,
      );
      continue;
    }
    const hierarchy = products[0].hierarchy;
    if (!String(hierarchy || '').startsWith('Supermarket/Pet Shop Products')) {
      blockingConditions.push(
        `approved sourceId=${sourceId}: not under Pet Shop hierarchy (${hierarchy})`,
      );
      continue;
    }
    eligibleSourceIds.push(sourceId);
  }

  const eligible = new Set(eligibleSourceIds);
  const skippedSourceIds = APPROVED_PET_SOURCE_IDS.filter(
    (sourceId) => !eligible.has(sourceId),
  );
  return {
    approvedCount: APPROVED_PET_SOURCE_IDS.length,
    eligibleCount: eligibleSourceIds.length,
    missingCount: missingSourceIds.length,
    skippedCount: skippedSourceIds.length,
    eligibleSourceIds,
    missingSourceIds,
    skippedSourceIds,
    blockingConditions,
  };
}

export function summarizeProtectedRows(
  rows: ApprovedProductRow[],
): ProtectedPreflightSummary {
  const grouped = new Map<string, ApprovedProductRow[]>();
  for (const row of rows) {
    const sourceId = String(row.sourceId);
    const group = grouped.get(sourceId) || [];
    group.push(row);
    grouped.set(sourceId, group);
  }

  const presentSourceIds: string[] = [];
  const missingSourceIds: string[] = [];
  const blockingConditions: string[] = [];
  for (const sourceId of PROTECTED_PET_SOURCE_IDS) {
    const products = grouped.get(sourceId) || [];
    if (products.length === 0) {
      missingSourceIds.push(sourceId);
      continue;
    }
    if (products.length !== 1) {
      blockingConditions.push(
        `protected sourceId=${sourceId}: duplicate active product rows=${products.length}`,
      );
      continue;
    }
    const product = products[0];
    if (!String(product.hierarchy || '').startsWith('Supermarket/Pet Shop Products')) {
      blockingConditions.push(
        `protected sourceId=${sourceId}: not under Pet Shop hierarchy (${product.hierarchy})`,
      );
      continue;
    }
    if (Number(product.isCuratedExternalCatalog) !== 0) {
      blockingConditions.push(
        `protected sourceId=${sourceId}: must be uncurated before apply (got curated=${product.isCuratedExternalCatalog})`,
      );
      continue;
    }
    presentSourceIds.push(sourceId);
  }

  const present = new Set(presentSourceIds);
  const skippedSourceIds = PROTECTED_PET_SOURCE_IDS.filter(
    (sourceId) => !present.has(sourceId),
  );
  return {
    protectedCount: PROTECTED_PET_SOURCE_IDS.length,
    presentCount: presentSourceIds.length,
    missingCount: missingSourceIds.length,
    skippedCount: skippedSourceIds.length,
    presentSourceIds,
    missingSourceIds,
    skippedSourceIds,
    blockingConditions,
  };
}

function requireNoPreflightBlockers(result: HandoffPreflightResult): void {
  if (result.blockingConditions.length) {
    throw new FailClosedError(
      `catalog preflight blocked: ${result.blockingConditions.join('; ')}`,
    );
  }
}

async function runPreflight(
  q: Q,
  effectiveEnv: Record<string, string>,
): Promise<HandoffPreflightResult> {
  assertNoApprovedProtectedOverlap();
  requireEnforcementOffVerified(effectiveEnv);

  let mappingId: number | null = null;
  let womenCanonicalId: number | null = null;
  const mappingBlockers: string[] = [];
  try {
    const cats = await q(
      `SELECT id, sourceName, hierarchy, status
       FROM category WHERE source = ? AND sourceId = ?`,
      [PROVIDER, KOMBINEZON_SOURCE_ID],
    );
    if (cats.length !== 1) {
      throw new FailClosedError(
        `expected exactly 1 trendyol category sourceId=${KOMBINEZON_SOURCE_ID}, got ${cats.length}`,
      );
    }
    if (
      cats[0].sourceName !== KOMBINEZON_SOURCE_NAME ||
      cats[0].hierarchy !== KOMBINEZON_HIERARCHY
    ) {
      throw new FailClosedError(
        `kombinezon identity mismatch: name=${cats[0].sourceName} hierarchy=${cats[0].hierarchy}`,
      );
    }

    const womenCc = await q(
      `SELECT cc.id
       FROM canonical_category cc
       JOIN canonical_category apparel ON apparel.id = cc.parentId AND apparel.name = 'پوشاک'
       JOIN canonical_category women ON women.id = apparel.parentId AND women.name = 'زنانه' AND women.parentId IS NULL
       WHERE cc.name = 'لباس زیر' AND cc.status = 'active'`,
    );
    if (womenCc.length !== 1) {
      throw new FailClosedError(
        `expected exactly 1 women underwear canonical, got ${womenCc.length}`,
      );
    }
    womenCanonicalId = Number(womenCc[0].id);

    const maps = await q(
      `SELECT m.id, m.status, m.genderSlice, m.canonicalCategoryId, m.sourceCategoryId
       FROM source_category_mapping m
       WHERE m.sourceCategoryId = ? AND m.canonicalCategoryId = ? AND m.genderSlice = 'any'`,
      [cats[0].id, womenCanonicalId],
    );
    if (maps.length !== 1) {
      throw new FailClosedError(
        `expected exactly 1 mapping (kombinezon→women underwear any), got ${maps.length}`,
      );
    }
    mappingId = Number(maps[0].id);

    const other = await q(
      `SELECT m.id, m.canonicalCategoryId, m.status
       FROM source_category_mapping m
       WHERE m.sourceCategoryId = ? AND NOT (m.canonicalCategoryId = ? AND m.genderSlice = 'any')`,
      [cats[0].id, womenCanonicalId],
    );
    if (other.length) {
      throw new FailClosedError(
        `unexpected extra mappings from kombinezon category: ${JSON.stringify(other)}`,
      );
    }
  } catch (error) {
    if (!(error instanceof FailClosedError)) throw error;
    mappingBlockers.push(error.message);
  }

  const trackedSourceIds = [
    ...APPROVED_PET_SOURCE_IDS,
    ...PROTECTED_PET_SOURCE_IDS,
  ];
  const trackedRows = (await q(
    `SELECT p.id, p.sourceId, p.categoryId, p.isCuratedExternalCatalog, c.hierarchy
     FROM product p
     LEFT JOIN category c ON c.id = p.categoryId
     WHERE p.source = ? AND p.isDeleted = 0
       AND p.sourceId IN (${placeholders(trackedSourceIds.length)})`,
    [PROVIDER, ...trackedSourceIds],
  )) as ApprovedProductRow[];
  const approvedRows = trackedRows.filter((row) =>
    APPROVED_PET_SOURCE_IDS.includes(String(row.sourceId)),
  );
  const protectedRows = trackedRows.filter((row) =>
    PROTECTED_PET_SOURCE_IDS.includes(String(row.sourceId)),
  );
  const showcase = summarizeApprovedShowcaseRows(approvedRows);
  const protectedProducts = summarizeProtectedRows(protectedRows);
  const rejected = {
    sourceId: REJECTED_PET_SOURCE_ID,
    status: protectedProducts.missingSourceIds.includes(REJECTED_PET_SOURCE_ID)
      ? ('missing' as const)
      : ('present' as const),
  };
  const blockingConditions = [
    ...mappingBlockers,
    ...showcase.blockingConditions,
    ...protectedProducts.blockingConditions,
  ];

  const extras = await q(
    `SELECT p.id, p.sourceId
     FROM product p
     JOIN category c ON c.id = p.categoryId
     WHERE p.source = ? AND p.isDeleted = 0 AND p.isCuratedExternalCatalog = 1
       AND c.hierarchy LIKE ?
       AND p.sourceId NOT IN (${placeholders(APPROVED_PET_SOURCE_IDS.length)})`,
    [PROVIDER, PET_HIERARCHY_PREFIX, ...APPROVED_PET_SOURCE_IDS],
  );
  if (extras.length) {
    blockingConditions.push(
      `unexpected curated pet products outside approved set: ${extras
        .map((r) => r.sourceId)
        .join(',')}`,
    );
  }

  return {
    mappingId,
    womenCanonicalId,
    showcase,
    protectedProducts,
    rejected,
    blockingConditions,
  };
}

async function loadProductSnaps(
  q: Q,
  ids: readonly string[],
  role: 'approved' | 'protected',
): Promise<ProductSnap[]> {
  const out: ProductSnap[] = [];
  for (const sourceId of ids) {
    const rows = await q(
      `SELECT p.id, p.sourceId, p.categoryId, p.isCuratedExternalCatalog,
              c.sourceId AS categorySourceId, c.hierarchy
       FROM product p
       JOIN category c ON c.id = p.categoryId
       WHERE p.source = ? AND p.sourceId = ? AND p.isDeleted = 0`,
      [PROVIDER, sourceId],
    );
    if (rows.length !== 1) {
      throw new FailClosedError(
        `snapshot ${role} sourceId=${sourceId}: expected 1 row, got ${rows.length}`,
      );
    }
    const r = rows[0];
    out.push({
      id: Number(r.id),
      sourceId,
      categoryId: Number(r.categoryId),
      isCuratedExternalCatalog: Number(r.isCuratedExternalCatalog),
      categorySourceId:
        r.categorySourceId == null ? null : String(r.categorySourceId),
      hierarchy: r.hierarchy == null ? null : String(r.hierarchy),
      role,
    });
  }
  return out;
}

async function capturePreState(
  q: Q,
  approvedSourceIds: readonly string[],
  protectedSourceIds: readonly string[],
): Promise<{
  mappingPre: MappingSnap;
  approvedProductsPre: ProductSnap[];
  protectedProductsPre: ProductSnap[];
}> {
  const mappingRows = await q(
    `SELECT m.id, m.source, m.sourceCategoryId, m.canonicalCategoryId, m.genderSlice,
            m.status, m.note, m.updatedAt, c.sourceId AS catSourceId, cc.name AS canonicalName
     FROM source_category_mapping m
     JOIN category c ON c.id = m.sourceCategoryId
     JOIN canonical_category cc ON cc.id = m.canonicalCategoryId
     JOIN canonical_category apparel ON apparel.id = cc.parentId AND apparel.name = 'پوشاک'
     JOIN canonical_category women ON women.id = apparel.parentId AND women.name = 'زنانه' AND women.parentId IS NULL
     WHERE c.source = ? AND c.sourceId = ? AND cc.name = 'لباس زیر' AND m.genderSlice = 'any'`,
    [PROVIDER, KOMBINEZON_SOURCE_ID],
  );
  if (mappingRows.length !== 1) {
    throw new FailClosedError(
      `snapshot mapping cardinality ${mappingRows.length} (expected 1)`,
    );
  }
  const m = mappingRows[0];
  return {
    mappingPre: {
      id: Number(m.id),
      source: String(m.source),
      sourceCategoryId: Number(m.sourceCategoryId),
      canonicalCategoryId: Number(m.canonicalCategoryId),
      genderSlice: String(m.genderSlice),
      status: String(m.status),
      note: m.note == null ? null : String(m.note),
      updatedAt: m.updatedAt == null ? null : String(m.updatedAt),
      catSourceId: String(m.catSourceId),
      canonicalName: String(m.canonicalName),
    },
    approvedProductsPre: await loadProductSnaps(q, approvedSourceIds, 'approved'),
    protectedProductsPre: await loadProductSnaps(q, protectedSourceIds, 'protected'),
  };
}

function productExpectation(
  p: ProductSnap,
  curated: 0 | 1,
): PostApplyProduct {
  return {
    id: p.id,
    source: PROVIDER,
    sourceId: p.sourceId,
    categoryId: p.categoryId,
    categorySourceId: p.categorySourceId,
    isCuratedExternalCatalog: curated,
  };
}

export function buildPostApplyExpectation(
  mappingPre: MappingSnap,
  approvedProductsPre: ProductSnap[],
  protectedProductsPre: ProductSnap[],
  mappingNoteAfter: string | null,
): PostApplyExpectation {
  return {
    mappingId: mappingPre.id,
    mappingSource: mappingPre.source,
    sourceCategoryId: mappingPre.sourceCategoryId,
    canonicalCategoryId: mappingPre.canonicalCategoryId,
    genderSlice: mappingPre.genderSlice,
    catSource: PROVIDER,
    catSourceId: mappingPre.catSourceId,
    mappingStatus: 'inactive',
    mappingNote: mappingNoteAfter,
    approved: approvedProductsPre.map((p) => productExpectation(p, 1)),
    protected: protectedProductsPre.map((p) => productExpectation(p, 0)),
  };
}

export function buildPreApplyExpectation(snap: Snapshot): PostApplyExpectation {
  return {
    mappingId: snap.mappingPre.id,
    mappingSource: snap.mappingPre.source,
    sourceCategoryId: snap.mappingPre.sourceCategoryId,
    canonicalCategoryId: snap.mappingPre.canonicalCategoryId,
    genderSlice: snap.mappingPre.genderSlice,
    catSource: PROVIDER,
    catSourceId: snap.mappingPre.catSourceId,
    mappingStatus: snap.mappingPre.status,
    mappingNote: snap.mappingPre.note,
    approved: snap.approvedProductsPre.map((p) =>
      productExpectation(p, Number(p.isCuratedExternalCatalog) as 0 | 1),
    ),
    protected: snap.protectedProductsPre.map((p) =>
      productExpectation(p, Number(p.isCuratedExternalCatalog) as 0 | 1),
    ),
  };
}

async function applyDesiredState(
  q: Q,
  approvedSourceIds: readonly string[],
): Promise<void> {
  // DML only — never DDL inside the transaction (implicit commit risk).
  await q(
    `UPDATE source_category_mapping m
     JOIN category c ON c.id = m.sourceCategoryId
     JOIN canonical_category cc ON cc.id = m.canonicalCategoryId
     JOIN canonical_category apparel ON apparel.id = cc.parentId AND apparel.name = 'پوشاک'
     JOIN canonical_category women ON women.id = apparel.parentId AND women.name = 'زنانه' AND women.parentId IS NULL
     SET m.status = 'inactive',
         m.note = CASE
           WHEN m.status = 'inactive' THEN m.note
           WHEN m.note IS NULL OR m.note = '' THEN 'Handoff: deactivate Kombinezon→women underwear'
           ELSE m.note
         END,
         m.updatedAt = UTC_TIMESTAMP()
     WHERE c.source = ? AND c.sourceId = ? AND cc.name = 'لباس زیر' AND m.genderSlice = 'any'`,
    [PROVIDER, KOMBINEZON_SOURCE_ID],
  );

  if (approvedSourceIds.length) {
    await q(
      `UPDATE product p
       JOIN category c ON c.id = p.categoryId
       SET p.isCuratedExternalCatalog = 1
       WHERE p.source = ? AND p.isDeleted = 0
         AND c.hierarchy LIKE ?
         AND p.sourceId IN (${placeholders(approvedSourceIds.length)})`,
      [PROVIDER, PET_HIERARCHY_PREFIX, ...approvedSourceIds],
    );
  }

  await q(
    `UPDATE product p
     SET p.isCuratedExternalCatalog = 0
     WHERE p.source = ? AND p.isDeleted = 0
       AND p.sourceId IN (${placeholders(PROTECTED_PET_SOURCE_IDS.length)})`,
    [PROVIDER, ...PROTECTED_PET_SOURCE_IDS],
  );
}

async function readMappingNote(q: Q, mappingId: number): Promise<string | null> {
  const rows = await q(
    `SELECT note FROM source_category_mapping WHERE id = ?`,
    [mappingId],
  );
  if (rows.length !== 1) {
    throw new FailClosedError('cannot read mapping note after apply');
  }
  return rows[0].note == null ? null : String(rows[0].note);
}

async function assertPostconditions(
  q: Q,
  approvedSourceIds: readonly string[],
  protectedSourceIds: readonly string[],
): Promise<void> {
  const map = await q(
    `SELECT m.status
     FROM source_category_mapping m
     JOIN category c ON c.id = m.sourceCategoryId
     JOIN canonical_category cc ON cc.id = m.canonicalCategoryId
     JOIN canonical_category apparel ON apparel.id = cc.parentId AND apparel.name = 'پوشاک'
     JOIN canonical_category women ON women.id = apparel.parentId AND women.name = 'زنانه'
     WHERE c.source = ? AND c.sourceId = ? AND cc.name = 'لباس زیر' AND m.genderSlice = 'any'`,
    [PROVIDER, KOMBINEZON_SOURCE_ID],
  );
  if (map.length !== 1 || map[0].status !== 'inactive') {
    throw new FailClosedError('postcondition: mapping not inactive');
  }

  const approved = await q(
    `SELECT COUNT(*) AS n, SUM(p.isCuratedExternalCatalog = 1) AS curated
     FROM product p
     JOIN category c ON c.id = p.categoryId
     WHERE p.source = ? AND p.isDeleted = 0 AND c.hierarchy LIKE ?
       AND p.sourceId IN (${placeholders(APPROVED_PET_SOURCE_IDS.length)})`,
    [PROVIDER, PET_HIERARCHY_PREFIX, ...APPROVED_PET_SOURCE_IDS],
  );
  if (
    Number(approved[0].n) !== approvedSourceIds.length ||
    Number(approved[0].curated) !== approvedSourceIds.length
  ) {
    throw new FailClosedError(
      `postcondition: approved curated expected ${approvedSourceIds.length}/${approvedSourceIds.length} got n=${approved[0].n} curated=${approved[0].curated}`,
    );
  }

  const protectedRows = await q(
    `SELECT COUNT(*) AS n, SUM(p.isCuratedExternalCatalog = 0) AS uncurated
     FROM product p
     WHERE p.source = ? AND p.isDeleted = 0
       AND p.sourceId IN (${placeholders(PROTECTED_PET_SOURCE_IDS.length)})`,
    [PROVIDER, ...PROTECTED_PET_SOURCE_IDS],
  );
  if (
    Number(protectedRows[0].n) !== protectedSourceIds.length ||
    Number(protectedRows[0].uncurated) !== protectedSourceIds.length
  ) {
    throw new FailClosedError(
      `postcondition: protected present count expected ${protectedSourceIds.length}/${protectedSourceIds.length} got n=${protectedRows[0].n} uncurated=${protectedRows[0].uncurated}`,
    );
  }

  const extras = await q(
    `SELECT COUNT(*) AS n FROM product p
     JOIN category c ON c.id = p.categoryId
     WHERE p.source = ? AND p.isDeleted = 0 AND p.isCuratedExternalCatalog = 1
       AND c.hierarchy LIKE ?
       AND p.sourceId NOT IN (${placeholders(APPROVED_PET_SOURCE_IDS.length)})`,
    [PROVIDER, PET_HIERARCHY_PREFIX, ...APPROVED_PET_SOURCE_IDS],
  );
  if (Number(extras[0].n) !== 0) {
    throw new FailClosedError(
      'postcondition: unexpected curated pet outside approved set',
    );
  }
}

/**
 * Shared identity gate for apply postconditions, rollback, and reconcile.
 * Compares full mapping + product identities — never curated/status alone.
 * Fail closed BEFORE any UPDATE on mismatch / missing / duplicate rows.
 */
async function assertExactCatalogIdentityState(
  q: Q,
  expected: PostApplyExpectation,
  label: string,
): Promise<void> {
  const map = await q(
    `SELECT m.id, m.source AS mappingSource, m.status, m.note, m.genderSlice,
            m.sourceCategoryId, m.canonicalCategoryId,
            c.sourceId AS catSourceId, c.source AS catSource
     FROM source_category_mapping m
     JOIN category c ON c.id = m.sourceCategoryId
     WHERE m.id = ?`,
    [expected.mappingId],
  );
  if (map.length !== 1) {
    throw new FailClosedError(
      `${label}: mapping row missing/duplicate count=${map.length} — refuse (no writes)`,
    );
  }
  const row = map[0];
  if (String(row.mappingSource) !== String(expected.mappingSource)) {
    throw new FailClosedError(
      `${label}: mapping.source drifted — refuse`,
    );
  }
  if (String(row.catSource) !== String(expected.catSource)) {
    throw new FailClosedError(
      `${label}: category.source drifted — refuse`,
    );
  }
  if (String(row.catSourceId) !== String(expected.catSourceId)) {
    throw new FailClosedError(
      `${label}: category.sourceId drifted — refuse`,
    );
  }
  if (Number(row.sourceCategoryId) !== Number(expected.sourceCategoryId)) {
    throw new FailClosedError(
      `${label}: mapping.sourceCategoryId drifted — refuse`,
    );
  }
  if (Number(row.canonicalCategoryId) !== Number(expected.canonicalCategoryId)) {
    throw new FailClosedError(
      `${label}: mapping.canonicalCategoryId drifted — refuse`,
    );
  }
  if (String(row.genderSlice) !== String(expected.genderSlice)) {
    throw new FailClosedError(
      `${label}: mapping.genderSlice drifted — refuse`,
    );
  }
  if (String(row.status) !== String(expected.mappingStatus)) {
    throw new FailClosedError(
      `${label}: mapping status=${row.status} expected=${expected.mappingStatus} — refuse`,
    );
  }
  if (!notesEqual(row.note, expected.mappingNote)) {
    throw new FailClosedError(`${label}: mapping note drifted — refuse`);
  }

  const allProducts = [...expected.approved, ...expected.protected];
  const seenIds = new Set<number>();
  for (const p of allProducts) {
    if (seenIds.has(p.id)) {
      throw new FailClosedError(
        `${label}: duplicate product expectation id=${p.id}`,
      );
    }
    seenIds.add(p.id);
    const rows = await q(
      `SELECT p.isCuratedExternalCatalog, p.categoryId, p.source, p.sourceId,
              c.sourceId AS categorySourceId, c.source AS categorySource
       FROM product p
       JOIN category c ON c.id = p.categoryId
       WHERE p.id = ? AND p.isDeleted = 0`,
      [p.id],
    );
    if (rows.length !== 1) {
      throw new FailClosedError(
        `${label}: product missing/ambiguous id=${p.id} sourceId=${p.sourceId} count=${rows.length}`,
      );
    }
    const r = rows[0];
    if (String(r.source) !== String(p.source) || String(r.sourceId) !== p.sourceId) {
      throw new FailClosedError(
        `${label}: product source identity drifted id=${p.id}`,
      );
    }
    if (Number(r.categoryId) !== Number(p.categoryId)) {
      throw new FailClosedError(
        `${label}: product categoryId drifted sourceId=${p.sourceId}`,
      );
    }
    if (String(r.categorySource) !== PROVIDER) {
      throw new FailClosedError(
        `${label}: product category.source drifted sourceId=${p.sourceId}`,
      );
    }
    const catSrc =
      r.categorySourceId == null ? null : String(r.categorySourceId);
    if (catSrc !== p.categorySourceId) {
      throw new FailClosedError(
        `${label}: product categorySourceId drifted sourceId=${p.sourceId}`,
      );
    }
    if (Number(r.isCuratedExternalCatalog) !== Number(p.isCuratedExternalCatalog)) {
      throw new FailClosedError(
        `${label}: curated drifted sourceId=${p.sourceId} — refuse`,
      );
    }
  }
}

async function assertExactPostApplyState(
  q: Q,
  post: PostApplyExpectation,
): Promise<void> {
  await assertExactCatalogIdentityState(q, post, 'post-apply gate');
}

async function assertExactPreApplyState(
  q: Q,
  snap: Snapshot,
): Promise<void> {
  await assertExactCatalogIdentityState(
    q,
    buildPreApplyExpectation(snap),
    'pre-apply gate',
  );
}

/** Classify durable DB vs snapshot for crash recovery (no writes). */
async function classifyRollbackDbState(
  q: Q,
  snap: Snapshot,
): Promise<'matches_post_apply' | 'matches_pre_apply' | 'ambiguous'> {
  try {
    await assertExactPostApplyState(q, snap.postApply);
    return 'matches_post_apply';
  } catch {
    /* continue */
  }
  try {
    await assertExactPreApplyState(q, snap);
    return 'matches_pre_apply';
  } catch {
    return 'ambiguous';
  }
}

/**
 * Detect incomplete/inconsistent snapshot artifact sets (crash mid-write).
 * Never fabricate lifecycle success from a partial set.
 */
function assertSnapshotArtifactsConsistent(
  snapshotFile: string,
  opts: { requireIntent?: boolean } = {},
): void {
  const snapExists = fs.existsSync(snapshotFile);
  const hashExists = fs.existsSync(`${snapshotFile}.sha256`);
  const lifeExists = fs.existsSync(lifecyclePath(snapshotFile));
  const intentExists = fs.existsSync(rollbackIntentPath(snapshotFile));

  if (!snapExists && !hashExists && !lifeExists && !intentExists) {
    throw new FailClosedError(
      'snapshot artifacts completely missing — refuse; do not fabricate lifecycle',
    );
  }
  if (snapExists !== hashExists) {
    throw new FailClosedError(
      `inconsistent snapshot artifacts (json=${snapExists} sha256=${hashExists}) — fail closed; manual recovery required (see README Crash recovery)`,
    );
  }
  if (snapExists && !lifeExists) {
    throw new FailClosedError(
      'snapshot JSON present but lifecycle sidecar missing — fail closed; manual recovery required',
    );
  }
  if (!snapExists && (lifeExists || intentExists)) {
    throw new FailClosedError(
      'orphan lifecycle/intent without snapshot JSON — fail closed; manual recovery required',
    );
  }
  if (opts.requireIntent && !intentExists) {
    throw new FailClosedError(
      'rollback-intent missing — cannot reconcile without intent evidence',
    );
  }
  if (snapExists && hashExists) {
    const raw = fs.readFileSync(snapshotFile, 'utf8');
    const expected = fs
      .readFileSync(`${snapshotFile}.sha256`, 'utf8')
      .trim()
      .split(/\s+/)[0];
    if (!expected || expected !== sha256Text(raw)) {
      throw new FailClosedError(
        'snapshot sha256 mismatch during artifact check — fail closed',
      );
    }
  }
}

async function restorePreState(
  q: Q,
  mappingPre: MappingSnap,
  approvedProductsPre: ProductSnap[],
  protectedProductsPre: ProductSnap[],
): Promise<void> {
  await q(
    `UPDATE source_category_mapping m
     JOIN category c ON c.id = m.sourceCategoryId
     SET m.status = ?, m.note = ?, m.updatedAt = UTC_TIMESTAMP()
     WHERE m.id = ?
       AND c.source = ?
       AND c.sourceId = ?
       AND m.sourceCategoryId = ?
       AND m.canonicalCategoryId = ?
       AND m.genderSlice = ?`,
    [
      mappingPre.status,
      mappingPre.note,
      mappingPre.id,
      PROVIDER,
      KOMBINEZON_SOURCE_ID,
      mappingPre.sourceCategoryId,
      mappingPre.canonicalCategoryId,
      mappingPre.genderSlice,
    ],
  );

  const mapNow = await q(
    `SELECT m.status, m.note, c.sourceId
     FROM source_category_mapping m
     JOIN category c ON c.id = m.sourceCategoryId
     WHERE m.id = ?`,
    [mappingPre.id],
  );
  const noteNow = mapNow[0]?.note == null ? null : String(mapNow[0].note);
  if (
    mapNow.length !== 1 ||
    String(mapNow[0].status) !== mappingPre.status ||
    String(mapNow[0].sourceId) !== KOMBINEZON_SOURCE_ID ||
    noteNow !== mappingPre.note
  ) {
    throw new FailClosedError('rollback mapping restore verification failed');
  }

  for (const p of [...approvedProductsPre, ...protectedProductsPre]) {
    await q(
      `UPDATE product SET isCuratedExternalCatalog = ?
       WHERE id = ? AND source = ? AND sourceId = ? AND categoryId = ? AND isDeleted = 0`,
      [
        p.isCuratedExternalCatalog,
        p.id,
        PROVIDER,
        p.sourceId,
        p.categoryId,
      ],
    );
    const after = await q(
      `SELECT isCuratedExternalCatalog, categoryId, sourceId FROM product WHERE id = ?`,
      [p.id],
    );
    if (
      after.length !== 1 ||
      Number(after[0].isCuratedExternalCatalog) !==
        Number(p.isCuratedExternalCatalog) ||
      Number(after[0].categoryId) !== Number(p.categoryId) ||
      String(after[0].sourceId) !== p.sourceId
    ) {
      throw new FailClosedError(
        `rollback product curated restore failed sourceId=${p.sourceId}`,
      );
    }
  }
}

/**
 * Canonical bytes hashed into RestoreEvidence.evidencePayloadSha256.
 * Excludes the digest field itself. Stable key order required.
 */
function buildRestoreEvidenceCanonicalPayload(
  ev: Omit<RestoreEvidence, 'evidencePayloadSha256'>,
): string {
  return JSON.stringify({
    schemaVersion: ev.schemaVersion,
    executionId: ev.executionId,
    approvedDatabaseName: ev.approvedDatabaseName,
    serverFingerprint: ev.serverFingerprint,
    backupPath: path.resolve(ev.backupPath),
    backupSha256: String(ev.backupSha256).toLowerCase(),
    scratchDatabaseName: ev.scratchDatabaseName,
    verifiedAt: ev.verifiedAt,
    verifiedBy: ev.verifiedBy,
    tableRowCounts: {
      source_category_mapping: Number(ev.tableRowCounts.source_category_mapping),
      product: Number(ev.tableRowCounts.product),
      category: Number(ev.tableRowCounts.category),
    },
  });
}

/**
 * Independently verifiable restore evidence from an authorized server operator
 * after a real scratch restore. Structural/crypto checks run locally; proving a
 * Production restore occurred still requires the server-side gate (README).
 */
function loadRestoreEvidence(
  filePath: string,
  bind: {
    executionId: string;
    database: string;
    serverFingerprint: string;
    backupPath: string;
    backupSha256: string;
  },
): RestoreEvidence {
  if (!fs.existsSync(filePath)) {
    throw new FailClosedError(
      `restore evidence missing: ${filePath} — self-declared YES is not acceptable proof`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as RestoreEvidence;
  if (Number(raw.schemaVersion) !== 1) {
    throw new FailClosedError(
      `restore evidence schemaVersion=${(raw as any).schemaVersion} (require 1)`,
    );
  }
  if (!raw.executionId || raw.executionId !== bind.executionId) {
    throw new FailClosedError(
      'restore evidence executionId missing or mismatch vs approved execution',
    );
  }
  if (raw.approvedDatabaseName !== bind.database) {
    throw new FailClosedError('restore evidence approvedDatabaseName mismatch');
  }
  if (raw.serverFingerprint !== bind.serverFingerprint) {
    throw new FailClosedError('restore evidence serverFingerprint mismatch');
  }
  if (path.resolve(raw.backupPath) !== path.resolve(bind.backupPath)) {
    throw new FailClosedError('restore evidence backupPath mismatch');
  }
  if (String(raw.backupSha256).toLowerCase() !== bind.backupSha256.toLowerCase()) {
    throw new FailClosedError('restore evidence backupSha256 mismatch vs backup file');
  }
  if (!raw.scratchDatabaseName || !String(raw.scratchDatabaseName).trim()) {
    throw new FailClosedError('restore evidence scratchDatabaseName required');
  }
  if (raw.scratchDatabaseName === bind.database) {
    throw new FailClosedError(
      'restore evidence scratchDatabaseName must differ from approved/target database',
    );
  }
  if (!raw.verifiedAt || !raw.verifiedBy || !String(raw.verifiedBy).trim()) {
    throw new FailClosedError('restore evidence verifiedAt/verifiedBy required');
  }
  const counts = raw.tableRowCounts;
  if (
    !counts ||
    !Number.isFinite(Number(counts.source_category_mapping)) ||
    !Number.isFinite(Number(counts.product)) ||
    !Number.isFinite(Number(counts.category)) ||
    Number(counts.source_category_mapping) < 0 ||
    Number(counts.product) < 0 ||
    Number(counts.category) < 0
  ) {
    throw new FailClosedError(
      'restore evidence tableRowCounts must include non-negative mapping/product/category counts',
    );
  }
  if (!raw.evidencePayloadSha256 || !/^[a-f0-9]{64}$/i.test(raw.evidencePayloadSha256)) {
    throw new FailClosedError('restore evidence evidencePayloadSha256 missing/invalid');
  }
  const { evidencePayloadSha256: _digest, ...withoutDigest } = raw;
  const expectedPayloadSha = sha256Text(
    buildRestoreEvidenceCanonicalPayload(withoutDigest),
  );
  if (raw.evidencePayloadSha256.toLowerCase() !== expectedPayloadSha.toLowerCase()) {
    throw new FailClosedError(
      'restore evidence evidencePayloadSha256 integrity failure — refuse',
    );
  }
  return raw;
}

/**
 * Backup attestation binds executionId + DB + server fingerprint + backup hash
 * to independently hashed RestoreEvidence. A bare YES field is never accepted.
 *
 * Local structural validation does NOT prove Production recoverability — see
 * README "Server-side restore verification gate".
 */
function loadBackupAttestation(filePath: string, bind: {
  executionId: string;
  database: string;
  serverFingerprint: string;
  backupPath: string;
  backupSha256: string;
}): BackupAttestation {
  if (!fs.existsSync(filePath)) {
    throw new FailClosedError(
      `backup attestation missing: ${filePath} (file hash alone is not proof of recoverability)`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BackupAttestation & {
    iAttestRestoreVerified?: string;
    restoreVerificationStatement?: string;
  };
  if ((raw as any).iAttestRestoreVerified != null) {
    throw new FailClosedError(
      'backup attestation must not rely on iAttestRestoreVerified=YES — provide restoreEvidencePath + restoreEvidenceSha256 from a real scratch restore',
    );
  }
  if (!raw.executionId || raw.executionId !== bind.executionId) {
    throw new FailClosedError(
      'backup attestation executionId missing or mismatch vs --execution-id',
    );
  }
  if (!raw.backupCreatedAt) {
    throw new FailClosedError('backup attestation backupCreatedAt required');
  }
  if (raw.approvedDatabaseName !== bind.database) {
    throw new FailClosedError('backup attestation database mismatch');
  }
  if (raw.serverFingerprint !== bind.serverFingerprint) {
    throw new FailClosedError('backup attestation server fingerprint mismatch');
  }
  if (path.resolve(raw.backupPath) !== path.resolve(bind.backupPath)) {
    throw new FailClosedError('backup attestation backupPath mismatch');
  }
  if (raw.backupSha256.toLowerCase() !== bind.backupSha256.toLowerCase()) {
    throw new FailClosedError('backup attestation sha256 mismatch vs file');
  }
  if (!raw.restoreEvidencePath || !raw.restoreEvidenceSha256) {
    throw new FailClosedError(
      'backup attestation requires restoreEvidencePath + restoreEvidenceSha256 (independent restore evidence artifact)',
    );
  }
  if (!/^[a-f0-9]{64}$/i.test(raw.restoreEvidenceSha256)) {
    throw new FailClosedError('backup attestation restoreEvidenceSha256 invalid');
  }
  const evidenceAbs = path.isAbsolute(raw.restoreEvidencePath)
    ? raw.restoreEvidencePath
    : path.resolve(path.dirname(filePath), raw.restoreEvidencePath);
  const evidenceFileSha = sha256File(evidenceAbs);
  if (evidenceFileSha.toLowerCase() !== raw.restoreEvidenceSha256.toLowerCase()) {
    throw new FailClosedError(
      'backup attestation restoreEvidenceSha256 mismatch vs restore evidence file',
    );
  }
  loadRestoreEvidence(evidenceAbs, bind);
  return {
    executionId: raw.executionId,
    approvedDatabaseName: raw.approvedDatabaseName,
    serverFingerprint: raw.serverFingerprint,
    backupPath: raw.backupPath,
    backupSha256: raw.backupSha256,
    backupCreatedAt: raw.backupCreatedAt,
    restoreEvidencePath: evidenceAbs,
    restoreEvidenceSha256: raw.restoreEvidenceSha256.toLowerCase(),
  };
}

function writeRollbackIntent(snapshotFile: string, intent: RollbackIntent): void {
  const p = rollbackIntentPath(snapshotFile);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(intent, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

function readRollbackIntent(snapshotFile: string): RollbackIntent | null {
  const p = rollbackIntentPath(snapshotFile);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as RollbackIntent;
}

/**
 * Require a durable rollback-intent that passes integrity, identity, and
 * execution binding. Never invent or repair a missing intent.
 */
function requireValidRollbackIntent(
  snapshotFile: string,
  snap: Snapshot,
  bind: {
    expectedExecutionId: string;
    database: string;
    serverFingerprint: string;
  },
): RollbackIntent {
  const p = rollbackIntentPath(snapshotFile);
  if (!fs.existsSync(p)) {
    throw new FailClosedError(
      'rollback-intent missing — refuse reconcile success (do not infer or repair intent)',
    );
  }
  let raw: RollbackIntent;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8')) as RollbackIntent;
  } catch {
    throw new FailClosedError(
      'rollback-intent malformed JSON — fail closed',
    );
  }
  if (Number(raw.schemaVersion) !== 1) {
    throw new FailClosedError(
      `rollback-intent schemaVersion=${(raw as any).schemaVersion} (require 1)`,
    );
  }
  if (!raw.executionId || raw.executionId !== bind.expectedExecutionId) {
    throw new FailClosedError(
      'reconcile: intent executionId missing or mismatch vs --execution-id',
    );
  }
  if (raw.executionId !== snap.executionId) {
    throw new FailClosedError('reconcile: intent executionId mismatch vs snapshot');
  }
  if (!raw.database || raw.database !== bind.database) {
    throw new FailClosedError('reconcile: intent database mismatch');
  }
  if (!raw.serverFingerprint || raw.serverFingerprint !== bind.serverFingerprint) {
    throw new FailClosedError('reconcile: intent server fingerprint mismatch');
  }
  if (raw.serverFingerprint !== snap.server.fingerprint) {
    throw new FailClosedError(
      'reconcile: intent server fingerprint mismatch vs snapshot',
    );
  }
  const snapHash = sha256Text(fs.readFileSync(snapshotFile, 'utf8'));
  if (!raw.snapshotSha256 || raw.snapshotSha256 !== snapHash) {
    throw new FailClosedError(
      'reconcile: intent snapshotSha256 mismatch vs snapshot file — fail closed',
    );
  }
  if (
    raw.phase !== 'pre_commit' &&
    raw.phase !== 'committed' &&
    raw.phase !== 'complete'
  ) {
    throw new FailClosedError(
      `reconcile: intent phase invalid (${String((raw as any).phase)})`,
    );
  }
  if (
    !raw.mappingPre ||
    Number(raw.mappingPre.id) !== Number(snap.mappingPre.id) ||
    String(raw.mappingPre.source) !== String(snap.mappingPre.source)
  ) {
    throw new FailClosedError(
      'reconcile: intent mappingPre identity mismatch vs snapshot',
    );
  }
  if (
    !raw.postApply ||
    Number(raw.postApply.mappingId) !== Number(snap.postApply.mappingId) ||
    String(raw.postApply.mappingSource) !== String(snap.postApply.mappingSource)
  ) {
    throw new FailClosedError(
      'reconcile: intent postApply identity mismatch vs snapshot',
    );
  }
  return raw;
}

function sealLifecycleRolledBack(snapshotFile: string, snap: Snapshot): void {
  const next: Snapshot = {
    ...snap,
    lifecycle: {
      status: 'rolled_back',
      rolledBackAt: new Date().toISOString(),
    },
  };
  const body = JSON.stringify(next, null, 2);
  const tmp = `${snapshotFile}.tmp`;
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, snapshotFile);
  fs.writeFileSync(
    `${snapshotFile}.sha256`,
    `${sha256Text(body)}  ${path.basename(snapshotFile)}\n`,
    'utf8',
  );
  fs.writeFileSync(
    lifecyclePath(snapshotFile),
    JSON.stringify(
      {
        executionId: next.executionId,
        status: next.lifecycle.status,
        rolledBackAt: next.lifecycle.rolledBackAt,
      },
      null,
      2,
    ),
    'utf8',
  );
}

function persistApplySnapshot(snapshot: Snapshot, outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${snapshot.executionId}.snapshot.json`);
  if (fs.existsSync(file)) {
    throw new FailClosedError(`snapshot already exists: ${file}`);
  }
  const body = JSON.stringify(snapshot, null, 2);
  const hash = sha256Text(body);
  fs.writeFileSync(file, body, 'utf8');
  fs.writeFileSync(
    `${file}.sha256`,
    `${hash}  ${path.basename(file)}\n`,
    'utf8',
  );
  fs.writeFileSync(
    lifecyclePath(file),
    JSON.stringify(
      {
        executionId: snapshot.executionId,
        status: snapshot.lifecycle.status,
        rolledBackAt: snapshot.lifecycle.rolledBackAt,
      },
      null,
      2,
    ),
    'utf8',
  );
  loadApplySnapshot(file, {
    expectedDatabase: snapshot.database,
    expectedServerFingerprint: snapshot.server.fingerprint,
    expectedExecutionId: snapshot.executionId,
    allowRolledBack: false,
  });
  return file;
}

function loadApplySnapshot(
  filePath: string,
  bind: {
    expectedDatabase: string;
    expectedServerFingerprint: string;
    expectedExecutionId: string;
    allowRolledBack: boolean;
  },
): Snapshot {
  if (!fs.existsSync(filePath)) {
    throw new FailClosedError(`snapshot not found: ${filePath}`);
  }
  const hashFile = `${filePath}.sha256`;
  if (!fs.existsSync(hashFile)) {
    throw new FailClosedError(
      'snapshot SHA256 sidecar missing — refuse (hard failure)',
    );
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const expected = fs.readFileSync(hashFile, 'utf8').trim().split(/\s+/)[0];
  const actual = sha256Text(raw);
  if (!expected || expected !== actual) {
    throw new FailClosedError('snapshot sha256 mismatch — refuse');
  }

  const snap = JSON.parse(raw) as Snapshot;
  if (snap.schemaVersion !== 3) {
    throw new FailClosedError(
      `unsupported snapshot schemaVersion=${(snap as any).schemaVersion} (require 3)`,
    );
  }
  if (snap.mode !== 'apply') {
    throw new FailClosedError(
      `snapshot mode=${snap.mode} is not rollback-eligible (require mode=apply)`,
    );
  }
  if (
    !snap.executionId ||
    !snap.mappingPre ||
    !snap.postApply ||
    !snap.server ||
    !snap.backupAttestation
  ) {
    throw new FailClosedError('snapshot missing required v3 fields');
  }
  if (!snap.backupPath || !snap.backupSha256) {
    throw new FailClosedError('snapshot missing verified backup reference');
  }
  if (!bind.expectedExecutionId || !bind.expectedExecutionId.trim()) {
    throw new FailClosedError(
      'rollback/reconcile requires explicit --execution-id=<apply executionId>',
    );
  }
  if (snap.executionId !== bind.expectedExecutionId) {
    throw new FailClosedError(
      `executionId mismatch: snapshot=${snap.executionId} approved=${bind.expectedExecutionId}`,
    );
  }
  if (snap.database !== bind.expectedDatabase) {
    throw new FailClosedError(
      `snapshot database=${snap.database} != connected=${bind.expectedDatabase}`,
    );
  }
  if (snap.approvedDatabaseName !== bind.expectedDatabase) {
    throw new FailClosedError('snapshot approvedDatabaseName mismatch');
  }
  if (!snap.server.fingerprint) {
    throw new FailClosedError('snapshot missing server.fingerprint');
  }
  if (snap.server.fingerprint !== bind.expectedServerFingerprint) {
    throw new FailClosedError(
      `snapshot server fingerprint mismatch (snapshot≠live) — refuse`,
    );
  }
  // When both sides have uuid, they must agree (already embedded in fingerprint when present).
  if (
    snap.backupAttestation.executionId !== snap.executionId ||
    snap.backupAttestation.backupSha256.toLowerCase() !==
      snap.backupSha256.toLowerCase() ||
    snap.backupAttestation.approvedDatabaseName !== snap.database ||
    snap.backupAttestation.serverFingerprint !== snap.server.fingerprint
  ) {
    throw new FailClosedError(
      'snapshot backupAttestation inconsistent with execution record (executionId/DB/fingerprint/hash)',
    );
  }
  if (
    !snap.backupAttestation.restoreEvidencePath ||
    !snap.backupAttestation.restoreEvidenceSha256
  ) {
    throw new FailClosedError(
      'snapshot backupAttestation missing restore evidence binding — refuse',
    );
  }
  if (
    !snap.postApply?.mappingSource ||
    !snap.postApply?.catSource ||
    !Array.isArray(snap.postApply.approved) ||
    !Array.isArray(snap.postApply.protected)
  ) {
    throw new FailClosedError(
      'snapshot postApply missing complete identity fields (mappingSource/catSource/products)',
    );
  }

  const lifeFile = lifecyclePath(filePath);
  if (!fs.existsSync(lifeFile)) {
    throw new FailClosedError('snapshot lifecycle sidecar missing — refuse');
  }
  const life = JSON.parse(fs.readFileSync(lifeFile, 'utf8')) as {
    executionId: string;
    status: string;
    rolledBackAt: string | null;
  };
  if (life.executionId !== snap.executionId) {
    throw new FailClosedError('lifecycle executionId mismatch');
  }
  if (life.status === 'rolled_back' || snap.lifecycle.status === 'rolled_back') {
    if (!bind.allowRolledBack) {
      throw new FailClosedError('snapshot already rolled back — refuse reuse');
    }
  } else if (life.status !== 'ready_for_rollback') {
    throw new FailClosedError(`unexpected lifecycle status=${life.status}`);
  }

  return snap;
}

async function shoeStrictPreflight(q: Q): Promise<{
  state: 'needs_fix' | 'already_correct';
  details: Record<string, unknown>;
}> {
  const collars = await q(
    `SELECT id, hierarchy, sourceId, sourceName FROM category
     WHERE source = ? AND sourceId = ?
       AND hierarchy = 'Supermarket/Pet Shop Products/Dog Products/Dog Collars'`,
    [PROVIDER, DOG_COLLARS_SOURCE_ID],
  );
  const shoesRoot = await q(
    `SELECT id, sourceId, sourceName FROM category
     WHERE source = ? AND sourceId = ? AND sourceName = 'Ayakkabı'`,
    [PROVIDER, SHOE_ROOT_SOURCE_ID],
  );
  if (collars.length !== 1 || shoesRoot.length !== 1) {
    throw new FailClosedError(
      `shoe preflight: expected unique Dog Collars + Ayakkabı roots (collars=${collars.length}, shoesRoot=${shoesRoot.length})`,
    );
  }

  const collarsId = Number(collars[0].id);
  const shoesRootId = Number(shoesRoot[0].id);
  const perId: Array<{
    sourceId: string;
    id: number;
    parentId: number;
    hierarchy: string;
  }> = [];

  for (const sourceId of SHOE_SOURCE_IDS) {
    const rows = await q(
      `SELECT id, sourceId, parentId, hierarchy
       FROM category WHERE source = ? AND sourceId = ?`,
      [PROVIDER, sourceId],
    );
    if (rows.length !== 1) {
      throw new FailClosedError(
        `shoe preflight: sourceId=${sourceId} expected exactly 1 row, got ${rows.length}`,
      );
    }
    const hierarchy = String(rows[0].hierarchy || '');
    if (!hierarchy.includes('Ayakkab') || !hierarchy.includes('Günlük')) {
      throw new FailClosedError(
        `shoe preflight: sourceId=${sourceId} hierarchy unexpected (${hierarchy})`,
      );
    }
    perId.push({
      sourceId,
      id: Number(rows[0].id),
      parentId: Number(rows[0].parentId),
      hierarchy,
    });
  }

  const underCollars = perId.filter((s) => s.parentId === collarsId);
  const underShoesRoot = perId.filter((s) => s.parentId === shoesRootId);
  const other = perId.filter(
    (s) => s.parentId !== collarsId && s.parentId !== shoesRootId,
  );
  if (other.length) {
    throw new FailClosedError(
      `shoe preflight: unexpected parents: ${JSON.stringify(other)}`,
    );
  }

  const ballerina = await q(
    `SELECT flat.id FROM category flat
     JOIN category babet ON babet.id = flat.parentId
     WHERE flat.source = ? AND flat.sourceId = ?
       AND babet.source = ? AND babet.sourceId = ?`,
    [PROVIDER, BALLERINA_SOURCE_ID, PROVIDER, BABET_SOURCE_ID],
  );
  if (ballerina.length !== 1) {
    throw new FailClosedError(
      `shoe preflight: Ballerina under Babet expected 1, got ${ballerina.length}`,
    );
  }

  if (underCollars.length === 4 && underShoesRoot.length === 0) {
    return {
      state: 'needs_fix',
      details: {
        collarsId,
        shoesRootId,
        sourceIds: [...SHOE_SOURCE_IDS],
        parents: underCollars.map((s) => ({
          sourceId: s.sourceId,
          parentId: s.parentId,
        })),
      },
    };
  }

  if (underShoesRoot.length === 4 && underCollars.length === 0) {
    return {
      state: 'already_correct',
      details: {
        collarsId,
        shoesRootId,
        sourceIds: [...SHOE_SOURCE_IDS],
        message:
          'All 4 expected shoe sourceIds already under Ayakkabı — report ALREADY_CORRECT; do not treat TypeORM no-op as a newly applied fix',
      },
    };
  }

  throw new FailClosedError(
    `shoe preflight: inconsistent mixed state underCollars=${underCollars.length} underShoesRoot=${underShoesRoot.length}`,
  );
}

async function main() {
  const mode = (arg('mode') || '') as Mode;
  const approvedDatabaseName = arg('approved-database-name');
  const backupPath = arg('backup-path');
  const backupAttestationPath = arg('backup-attestation');
  const snapshotPath = arg('snapshot');
  const snapshotDir = arg('snapshot-dir') || defaultSnapshotDir();
  const approveWrite = arg('i-approve-write') === 'YES';
  const expectedExecutionId = arg('execution-id');

  if (
    ![
      'preflight',
      'validate-local',
      'apply',
      'rollback',
      'reconcile-rollback',
      'shoe-preflight',
    ].includes(mode)
  ) {
    throw new FailClosedError(
      'required --mode=preflight|validate-local|apply|rollback|reconcile-rollback|shoe-preflight',
    );
  }

  const effectiveEnv = loadEffectiveEnv();
  // Read-only modes still verify OFF so operators see the same effective config.
  requireEnforcementOffVerified(effectiveEnv);
  requireEnforcementOffForWrites(effectiveEnv, mode);

  const conn = await connect(effectiveEnv);
  const q = makeQ(conn);

  try {
    const database = await requireDbIdentity(q, approvedDatabaseName);
    await requireSchema(q);
    const server = await readServerIdentity(q);

    if (mode === 'shoe-preflight') {
      const result = await shoeStrictPreflight(q);
      console.log(
        JSON.stringify({ ok: true, mode, database, server, shoe: result }, null, 2),
      );
      return;
    }

    if (mode === 'preflight') {
      const ids = await runPreflight(q, effectiveEnv);
      console.log(
        JSON.stringify(
          {
            ok: ids.blockingConditions.length === 0,
            mode,
            database,
            server,
            mappingId: ids.mappingId,
            womenCanonicalId: ids.womenCanonicalId,
            showcase: ids.showcase,
            protectedProducts: ids.protectedProducts,
            rejected: ids.rejected,
            blockingConditions: ids.blockingConditions,
            enforcement: 'OFF_VERIFIED',
          },
          null,
          2,
        ),
      );
      if (ids.blockingConditions.length) process.exitCode = 1;
      return;
    }

    if (mode === 'validate-local') {
      if (database !== 'ragashop_local') {
        throw new FailClosedError(
          'validate-local only permitted when approved DB is ragashop_local',
        );
      }
      const preflight = await runPreflight(q, effectiveEnv);
      requireNoPreflightBlockers(preflight);
      await conn.beginTransaction();
      try {
        const approvedSourceIds = preflight.showcase.eligibleSourceIds;
        const protectedSourceIds = preflight.protectedProducts.presentSourceIds;
        const pre = await capturePreState(
          q,
          approvedSourceIds,
          protectedSourceIds,
        );
        await applyDesiredState(q, approvedSourceIds);
        await assertPostconditions(q, approvedSourceIds, protectedSourceIds);
        const mappingNoteAfter = await readMappingNote(q, pre.mappingPre.id);
        const postApply = buildPostApplyExpectation(
          pre.mappingPre,
          pre.approvedProductsPre,
          pre.protectedProductsPre,
          mappingNoteAfter,
        );
        await assertExactPostApplyState(q, postApply);
        await restorePreState(
          q,
          pre.mappingPre,
          pre.approvedProductsPre,
          pre.protectedProductsPre,
        );
        await conn.rollback();
      } catch (e) {
        await conn.rollback();
        throw e;
      }
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode,
            database,
            server,
            note: 'transaction rolled back — Local catalog data unchanged',
            enforcement: 'OFF_VERIFIED',
            rollbackEligibleSnapshotPersisted: false,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (mode === 'apply') {
      if (!approveWrite) {
        throw new FailClosedError(
          'apply requires --i-approve-write=YES (explicit operator gate)',
        );
      }
      if (!expectedExecutionId || !expectedExecutionId.trim()) {
        throw new FailClosedError(
          'apply requires --execution-id=<id> prepared in advance and bound into backup attestation + restore evidence',
        );
      }
      if (!backupPath || !fs.existsSync(backupPath)) {
        throw new FailClosedError(
          'apply requires existing --backup-path=<dump file> (hash alone is not recoverability proof)',
        );
      }
      if (!backupAttestationPath) {
        throw new FailClosedError(
          'apply requires --backup-attestation=<json> bound to restore evidence artifact',
        );
      }
      const executionId = expectedExecutionId.trim();
      const backupSha256 = sha256File(backupPath);
      const backupAttestation = loadBackupAttestation(backupAttestationPath, {
        executionId,
        database,
        serverFingerprint: server.fingerprint,
        backupPath,
        backupSha256,
      });
      const preflight = await runPreflight(q, effectiveEnv);
      requireNoPreflightBlockers(preflight);

      await conn.beginTransaction();
      let snapFile = '';
      try {
        const approvedSourceIds = preflight.showcase.eligibleSourceIds;
        const protectedSourceIds = preflight.protectedProducts.presentSourceIds;
        const pre = await capturePreState(
          q,
          approvedSourceIds,
          protectedSourceIds,
        );
        await applyDesiredState(q, approvedSourceIds);
        await assertPostconditions(q, approvedSourceIds, protectedSourceIds);
        const mappingNoteAfter = await readMappingNote(q, pre.mappingPre.id);
        const postApply = buildPostApplyExpectation(
          pre.mappingPre,
          pre.approvedProductsPre,
          pre.protectedProductsPre,
          mappingNoteAfter,
        );
        const snapshot: Snapshot = {
          schemaVersion: 3,
          executionId,
          createdAt: new Date().toISOString(),
          mode: 'apply',
          database,
          approvedDatabaseName: database,
          server,
          backupPath,
          backupSha256,
          backupAttestation,
          mappingPre: pre.mappingPre,
          approvedProductsPre: pre.approvedProductsPre,
          protectedProductsPre: pre.protectedProductsPre,
          postApply,
          lifecycle: { status: 'ready_for_rollback', rolledBackAt: null },
        };
        // Persist evidence before COMMIT so rollback material exists if commit succeeds.
        snapFile = persistApplySnapshot(snapshot, snapshotDir);
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      }

      console.log(
        JSON.stringify(
          {
            ok: true,
            mode,
            database,
            server,
            executionId,
            snapshotFile: snapFile,
            backupPath,
            backupSha256,
            ambiguousCommitRecovery:
              'If connection lost during COMMIT: reconnect; compare durable rows to snapshot postApply/pre; never blind re-run. Use --mode=reconcile-rollback for lifecycle crash after a committed rollback.',
          },
          null,
          2,
        ),
      );
      return;
    }

    if (mode === 'rollback') {
      if (!approveWrite) {
        throw new FailClosedError('rollback requires --i-approve-write=YES');
      }
      if (!snapshotPath) {
        throw new FailClosedError('rollback requires --snapshot=<path>');
      }
      if (!expectedExecutionId || !expectedExecutionId.trim()) {
        throw new FailClosedError(
          'rollback requires explicit --execution-id=<apply executionId>',
        );
      }
      requireEnforcementOffVerified(effectiveEnv);

      const snap = loadApplySnapshot(snapshotPath, {
        expectedDatabase: database,
        expectedServerFingerprint: server.fingerprint,
        expectedExecutionId: expectedExecutionId.trim(),
        allowRolledBack: false,
      });

      const snapHash = sha256Text(fs.readFileSync(snapshotPath, 'utf8'));
      // Durable intent BEFORE mutating DB — enables crash classification.
      writeRollbackIntent(snapshotPath, {
        schemaVersion: 1,
        executionId: snap.executionId,
        snapshotPath,
        snapshotSha256: snapHash,
        database,
        serverFingerprint: server.fingerprint,
        phase: 'pre_commit',
        updatedAt: new Date().toISOString(),
        postApply: snap.postApply,
        mappingPre: snap.mappingPre,
        approvedProductsPre: snap.approvedProductsPre,
        protectedProductsPre: snap.protectedProductsPre,
      });

      await conn.beginTransaction();
      try {
        await assertExactPostApplyState(q, snap.postApply);
        await restorePreState(
          q,
          snap.mappingPre,
          snap.approvedProductsPre,
          snap.protectedProductsPre,
        );
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        // Leave intent at pre_commit so reconcile can see "not committed".
        throw e;
      }

      writeRollbackIntent(snapshotPath, {
        schemaVersion: 1,
        executionId: snap.executionId,
        snapshotPath,
        snapshotSha256: snapHash,
        database,
        serverFingerprint: server.fingerprint,
        phase: 'committed',
        updatedAt: new Date().toISOString(),
        postApply: snap.postApply,
        mappingPre: snap.mappingPre,
        approvedProductsPre: snap.approvedProductsPre,
        protectedProductsPre: snap.protectedProductsPre,
      });

      sealLifecycleRolledBack(snapshotPath, snap);
      // Snapshot bytes change on seal — re-bind intent hash to sealed content.
      const sealedSnapHash = sha256Text(fs.readFileSync(snapshotPath, 'utf8'));

      writeRollbackIntent(snapshotPath, {
        schemaVersion: 1,
        executionId: snap.executionId,
        snapshotPath,
        snapshotSha256: sealedSnapHash,
        database,
        serverFingerprint: server.fingerprint,
        phase: 'complete',
        updatedAt: new Date().toISOString(),
        postApply: snap.postApply,
        mappingPre: snap.mappingPre,
        approvedProductsPre: snap.approvedProductsPre,
        protectedProductsPre: snap.protectedProductsPre,
      });

      // Success only after durable lifecycle says rolled_back
      const life = JSON.parse(
        fs.readFileSync(lifecyclePath(snapshotPath), 'utf8'),
      ) as { status: string };
      if (life.status !== 'rolled_back') {
        throw new FailClosedError(
          'lifecycle not sealed rolled_back after commit — run reconcile-rollback; do not re-run rollback blindly',
        );
      }

      console.log(
        JSON.stringify(
          {
            ok: true,
            mode,
            database,
            server,
            restoredFrom: snapshotPath,
            executionId: snap.executionId,
            lifecycle: 'rolled_back',
          },
          null,
          2,
        ),
      );
      return;
    }

    if (mode === 'reconcile-rollback') {
      // Fail-closed recovery for crash between DB COMMIT and lifecycle seal.
      // Never mutates catalog rows. Seals filesystem only when full pre-apply
      // identity matches (assertExactPreApplyState via classifyRollbackDbState).
      if (!snapshotPath) {
        throw new FailClosedError('reconcile-rollback requires --snapshot=<path>');
      }
      if (!expectedExecutionId || !expectedExecutionId.trim()) {
        throw new FailClosedError(
          'reconcile-rollback requires --execution-id=<apply executionId>',
        );
      }
      requireEnforcementOffVerified(effectiveEnv);

      // Crash between snapshot / sha256 / lifecycle / intent → fail closed;
      // never fabricate lifecycle success from a partial artifact set.
      // Intent is mandatory for ANY reconcile success (including already_complete).
      assertSnapshotArtifactsConsistent(snapshotPath, { requireIntent: true });

      const snap = loadApplySnapshot(snapshotPath, {
        expectedDatabase: database,
        expectedServerFingerprint: server.fingerprint,
        expectedExecutionId: expectedExecutionId.trim(),
        allowRolledBack: true,
      });
      const intent = requireValidRollbackIntent(snapshotPath, snap, {
        expectedExecutionId: expectedExecutionId.trim(),
        database,
        serverFingerprint: server.fingerprint,
      });

      const dbClass = await classifyRollbackDbState(q, snap);
      const life = fs.existsSync(lifecyclePath(snapshotPath))
        ? (JSON.parse(
            fs.readFileSync(lifecyclePath(snapshotPath), 'utf8'),
          ) as { status: string })
        : null;

      async function sealOnlyWhenFullPreApplyMatches(
        classification: string,
        detail: string,
      ): Promise<void> {
        // Refuse to mark rollback complete unless full verified pre-apply matches.
        await assertExactPreApplyState(q, snap);
        if (life?.status !== 'rolled_back') {
          sealLifecycleRolledBack(snapshotPath, snap);
        }
        const sealedSnapHash = sha256Text(fs.readFileSync(snapshotPath, 'utf8'));
        writeRollbackIntent(snapshotPath, {
          ...intent,
          snapshotSha256: sealedSnapHash,
          phase: 'complete',
          updatedAt: new Date().toISOString(),
        });
        console.log(
          JSON.stringify(
            {
              ok: true,
              mode,
              classification,
              detail,
              dbClass: 'matches_pre_apply',
              catalogWrites: false,
            },
            null,
            2,
          ),
        );
      }

      if (intent.phase === 'pre_commit') {
        if (dbClass === 'matches_post_apply') {
          console.log(
            JSON.stringify(
              {
                ok: true,
                mode,
                classification: 'a_rollback_not_committed',
                detail:
                  'Intent pre_commit and DB still full post-apply identity — safe to retry rollback after operator approval',
                dbClass,
                catalogWrites: false,
              },
              null,
              2,
            ),
          );
          return;
        }
        if (dbClass === 'matches_pre_apply') {
          await sealOnlyWhenFullPreApplyMatches(
            'b_committed_lifecycle_incomplete_sealed',
            'DB already full pre-apply identity; sealed lifecycle without catalog writes',
          );
          return;
        }
        throw new FailClosedError(
          'reconcile classification c_ambiguous (pre_commit intent, DB matches neither full post- nor pre-apply identity) — manual recovery; do not overwrite later changes',
        );
      }

      if (intent.phase === 'committed') {
        if (dbClass !== 'matches_pre_apply') {
          throw new FailClosedError(
            `reconcile classification c_ambiguous (intent committed but dbClass=${dbClass}; full pre-apply identity required to seal) — manual recovery`,
          );
        }
        await sealOnlyWhenFullPreApplyMatches(
          'b_committed_lifecycle_incomplete_sealed',
          'Intent committed; full pre-apply identity verified; sealed lifecycle without catalog writes',
        );
        return;
      }

      if (intent.phase === 'complete' && life?.status === 'rolled_back') {
        if (dbClass !== 'matches_pre_apply') {
          throw new FailClosedError(
            `reconcile: lifecycle claims complete/rolled_back but DB does not match full pre-apply identity (dbClass=${dbClass}) — refuse`,
          );
        }
        await assertExactPreApplyState(q, snap);
        console.log(
          JSON.stringify(
            {
              ok: true,
              mode,
              classification: 'already_complete',
              dbClass,
              catalogWrites: false,
            },
            null,
            2,
          ),
        );
        return;
      }

      throw new FailClosedError(
        `reconcile classification c_ambiguous phase=${intent.phase} lifecycle=${life?.status} dbClass=${dbClass}`,
      );
    }
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
    process.exit(1);
  });
}
