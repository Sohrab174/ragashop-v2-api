/**
 * Narrow prerequisite seed for the catalog handoff's Kombinezon mapping.
 *
 * Modes are explicitly selected: dry-run (read-only), seed (one INSERT), and
 * rollback (delete only the exact seed row, after proving handoff safety).
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as mysql from 'mysql2/promise';

export const SEED_SOURCE = 'trendyol';
export const SEED_SOURCE_ID = '1099';
export const SEED_SOURCE_NAME = 'Kombinezon';
export const SEED_SOURCE_HIERARCHY = 'Giyim/İç Giyim/Kombinezon';
export const SEED_CANONICAL_NAMES = {
  root: 'زنانه',
  parent: 'پوشاک',
  leaf: 'لباس زیر',
} as const;
export const SEED_GENDER_SLICE = 'any';
export const SEED_MAPPING_STATUS = 'inactive';
export const SEED_REVIEW_STATUS = 'legacy_unreviewed';
export const SEED_PROVENANCE_NOTE =
  'seed:catalog-handoff-underwear-pet:kombinezon-women-underwear:any:v1';

export interface SeedDbConnection {
  query(sql: string, values?: unknown[]): Promise<[any, any]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  end?(): Promise<void>;
}

type ResolvedTarget = {
  sourceCategoryId: number;
  canonicalCategoryId: number;
};

type ExistingMapping = {
  id: number;
  source: string;
  sourceCategoryId: number;
  canonicalCategoryId: number;
  genderSlice: string;
  status: string;
  reviewStatus: string;
  note: string | null;
};

export type SeedResult = {
  outcome: 'ready_to_seed' | 'seeded' | 'already_applied' | 'rolled_back';
  sourceCategoryId: number;
  canonicalCategoryId: number;
  mappingId?: number;
};

export type HandoffRollbackProof =
  | { kind: 'never_applied'; explicitlyConfirmed: true }
  | {
      kind: 'rolled_back';
      executionId: string;
      snapshotText: string;
      checksumText: string;
      lifecycleText: string;
    };

export class PrerequisiteSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrerequisiteSeedError';
  }
}

const REQUIRED_COLUMNS: Record<string, string[]> = {
  category: ['id', 'source', 'sourceId', 'sourceName', 'hierarchy', 'status'],
  canonical_category: ['id', 'parentId', 'name', 'status'],
  source_category_mapping: [
    'id',
    'source',
    'sourceCategoryId',
    'canonicalCategoryId',
    'genderSlice',
    'status',
    'reviewStatus',
    'note',
    'createdAt',
    'updatedAt',
  ],
};

async function rows(
  connection: SeedDbConnection,
  sql: string,
  values: unknown[] = [],
): Promise<any[]> {
  const [result] = await connection.query(sql, values);
  return Array.isArray(result) ? result : [];
}

function exactlyOne<T>(items: T[], description: string): T {
  if (items.length !== 1) {
    throw new PrerequisiteSeedError(
      `${description}: expected exactly one row, got ${items.length}`,
    );
  }
  return items[0];
}

async function assertDatabase(
  connection: SeedDbConnection,
  approvedDatabaseName: string,
): Promise<void> {
  if (!/^[A-Za-z0-9_]+$/.test(approvedDatabaseName)) {
    throw new PrerequisiteSeedError('invalid approved database name');
  }
  const result = exactlyOne(
    await rows(connection, 'SELECT DATABASE() AS db'),
    'database identity',
  );
  if (String(result.db || '') !== approvedDatabaseName) {
    throw new PrerequisiteSeedError(
      'connected database does not match the approved database name',
    );
  }
}

async function assertSchema(connection: SeedDbConnection): Promise<void> {
  const tableRows = await rows(
    connection,
    `SELECT table_name AS tableName, engine
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN ('category','canonical_category','source_category_mapping')`,
  );
  const engines = new Map(
    tableRows.map((row) => [
      String(row.tableName),
      String(row.engine).toUpperCase(),
    ]),
  );
  for (const table of Object.keys(REQUIRED_COLUMNS)) {
    if (engines.get(table) !== 'INNODB') {
      throw new PrerequisiteSeedError(
        `required table ${table} is missing or is not InnoDB`,
      );
    }
  }

  const columnRows = await rows(
    connection,
    `SELECT table_name AS tableName, column_name AS columnName
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND ((table_name = 'category' AND column_name IN ('id','source','sourceId','sourceName','hierarchy','status'))
         OR (table_name = 'canonical_category' AND column_name IN ('id','parentId','name','status'))
         OR (table_name = 'source_category_mapping' AND column_name IN ('id','source','sourceCategoryId','canonicalCategoryId','genderSlice','status','reviewStatus','note','createdAt','updatedAt')))`,
  );
  const present = new Map<string, Set<string>>();
  for (const row of columnRows) {
    const table = String(row.tableName);
    if (!present.has(table)) present.set(table, new Set());
    present.get(table)!.add(String(row.columnName));
  }
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    for (const column of columns) {
      if (!present.get(table)?.has(column)) {
        throw new PrerequisiteSeedError(
          `required schema column missing: ${table}.${column}`,
        );
      }
    }
  }

  const uniqueIndex = await rows(
    connection,
    `SELECT column_name AS columnName, seq_in_index AS seqInIndex, non_unique AS nonUnique
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'source_category_mapping'
       AND index_name = 'uq_scm_source_category_gender_slice'
     ORDER BY seq_in_index`,
  );
  if (
    uniqueIndex.length !== 2 ||
    String(uniqueIndex[0].columnName) !== 'sourceCategoryId' ||
    Number(uniqueIndex[0].seqInIndex) !== 1 ||
    String(uniqueIndex[1].columnName) !== 'genderSlice' ||
    Number(uniqueIndex[1].seqInIndex) !== 2 ||
    Number(uniqueIndex[0].nonUnique) !== 0 ||
    Number(uniqueIndex[1].nonUnique) !== 0
  ) {
    throw new PrerequisiteSeedError(
      'required unique index uq_scm_source_category_gender_slice is missing or incompatible',
    );
  }
}

async function resolveTarget(
  connection: SeedDbConnection,
  forUpdate: boolean,
): Promise<ResolvedTarget> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const sourceRows = await rows(
    connection,
    `SELECT id, source, sourceId, sourceName, hierarchy, status
     FROM category
     WHERE source = ? AND sourceId = ?${lock}`,
    [SEED_SOURCE, SEED_SOURCE_ID],
  );
  const source = exactlyOne(sourceRows, 'Trendyol Kombinezon source category');
  if (
    String(source.sourceName) !== SEED_SOURCE_NAME ||
    String(source.hierarchy) !== SEED_SOURCE_HIERARCHY ||
    String(source.status) === 'inactive'
  ) {
    throw new PrerequisiteSeedError(
      'source category identity is unexpected or inactive',
    );
  }

  const canonicalRows = await rows(
    connection,
    `SELECT leaf.id AS canonicalCategoryId,
            leaf.name AS leafName,
            leaf.status AS leafStatus,
            parent.name AS parentName,
            parent.status AS parentStatus,
            root.name AS rootName,
            root.status AS rootStatus,
            root.parentId AS rootParentId
     FROM canonical_category AS root
     JOIN canonical_category AS parent ON parent.parentId = root.id
     JOIN canonical_category AS leaf ON leaf.parentId = parent.id
     WHERE root.name = ? AND root.parentId IS NULL
       AND parent.name = ?
       AND leaf.name = ? AND leaf.status = 'active'${lock}`,
    [
      SEED_CANONICAL_NAMES.root,
      SEED_CANONICAL_NAMES.parent,
      SEED_CANONICAL_NAMES.leaf,
    ],
  );
  const canonical = exactlyOne(
    canonicalRows,
    'active women underwear canonical path',
  );
  if (
    String(canonical.rootName) !== SEED_CANONICAL_NAMES.root ||
    String(canonical.parentName) !== SEED_CANONICAL_NAMES.parent ||
    String(canonical.leafName) !== SEED_CANONICAL_NAMES.leaf ||
    String(canonical.rootStatus) !== 'active' ||
    String(canonical.parentStatus) !== 'active' ||
    String(canonical.leafStatus) !== 'active' ||
    canonical.rootParentId != null
  ) {
    throw new PrerequisiteSeedError(
      'canonical destination path is not fully active',
    );
  }

  return {
    sourceCategoryId: Number(source.id),
    canonicalCategoryId: Number(canonical.canonicalCategoryId),
  };
}

function isExactSeedMapping(
  mapping: ExistingMapping,
  target: ResolvedTarget,
): boolean {
  return (
    Number(mapping.sourceCategoryId) === target.sourceCategoryId &&
    Number(mapping.canonicalCategoryId) === target.canonicalCategoryId &&
    String(mapping.source) === SEED_SOURCE &&
    String(mapping.genderSlice) === SEED_GENDER_SLICE &&
    String(mapping.status) === SEED_MAPPING_STATUS &&
    String(mapping.reviewStatus) === SEED_REVIEW_STATUS &&
    mapping.note === SEED_PROVENANCE_NOTE
  );
}

async function inspectExistingMapping(
  connection: SeedDbConnection,
  target: ResolvedTarget,
  forUpdate: boolean,
): Promise<ExistingMapping | null> {
  const mappings = (await rows(
    connection,
    `SELECT id, source, sourceCategoryId, canonicalCategoryId,
            genderSlice, status, reviewStatus, note
     FROM source_category_mapping
     WHERE sourceCategoryId = ?${forUpdate ? ' FOR UPDATE' : ''}`,
    [target.sourceCategoryId],
  )) as ExistingMapping[];

  if (mappings.length === 0) return null;
  if (mappings.length === 1 && isExactSeedMapping(mappings[0], target)) {
    return mappings[0];
  }
  throw new PrerequisiteSeedError(
    'source category already has a conflicting, changed, or duplicate mapping; no changes made',
  );
}

async function resolveForMode(
  connection: SeedDbConnection,
  approvedDatabaseName: string,
  forUpdate: boolean,
): Promise<{ target: ResolvedTarget; existing: ExistingMapping | null }> {
  await assertDatabase(connection, approvedDatabaseName);
  await assertSchema(connection);
  const target = await resolveTarget(connection, forUpdate);
  const existing = await inspectExistingMapping(connection, target, forUpdate);
  return { target, existing };
}

export async function dryRunPrerequisiteSeed(
  connection: SeedDbConnection,
  approvedDatabaseName: string,
): Promise<SeedResult> {
  const { target, existing } = await resolveForMode(
    connection,
    approvedDatabaseName,
    false,
  );
  return {
    outcome: existing ? 'already_applied' : 'ready_to_seed',
    sourceCategoryId: target.sourceCategoryId,
    canonicalCategoryId: target.canonicalCategoryId,
    ...(existing ? { mappingId: Number(existing.id) } : {}),
  };
}

export async function seedPrerequisiteMapping(
  connection: SeedDbConnection,
  approvedDatabaseName: string,
): Promise<SeedResult> {
  await connection.beginTransaction();
  let transactionActive = true;
  try {
    const { target, existing } = await resolveForMode(
      connection,
      approvedDatabaseName,
      true,
    );
    if (existing) {
      await connection.commit();
      transactionActive = false;
      return {
        outcome: 'already_applied',
        sourceCategoryId: target.sourceCategoryId,
        canonicalCategoryId: target.canonicalCategoryId,
        mappingId: Number(existing.id),
      };
    }

    const [insertResult] = await connection.query(
      `INSERT INTO source_category_mapping
        (source, sourceCategoryId, canonicalCategoryId, genderSlice,
         status, reviewStatus, note, createdAt, updatedAt)
       VALUES (?, ?, ?, 'any', 'inactive', 'legacy_unreviewed', ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [
        SEED_SOURCE,
        target.sourceCategoryId,
        target.canonicalCategoryId,
        SEED_PROVENANCE_NOTE,
      ],
    );
    const inserted = insertResult as {
      affectedRows?: number;
      insertId?: number;
    };
    if (Number(inserted.affectedRows) !== 1 || !Number(inserted.insertId)) {
      throw new PrerequisiteSeedError(
        'seed INSERT did not create exactly one row',
      );
    }

    const created = (await rows(
      connection,
      `SELECT id, source, sourceCategoryId, canonicalCategoryId,
              genderSlice, status, reviewStatus, note
       FROM source_category_mapping WHERE id = ? FOR UPDATE`,
      [inserted.insertId],
    )) as ExistingMapping[];
    const row = exactlyOne(created, 'inserted prerequisite mapping');
    if (!isExactSeedMapping(row, target)) {
      throw new PrerequisiteSeedError(
        'inserted mapping failed exact identity verification',
      );
    }

    await connection.commit();
    transactionActive = false;
    return {
      outcome: 'seeded',
      sourceCategoryId: target.sourceCategoryId,
      canonicalCategoryId: target.canonicalCategoryId,
      mappingId: Number(inserted.insertId),
    };
  } catch (error) {
    if (transactionActive) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original failure; the operator must verify DB state.
      }
    }
    throw error;
  }
}

function parseJson(text: string, description: string): any {
  try {
    return JSON.parse(text);
  } catch {
    throw new PrerequisiteSeedError(`${description} is not valid JSON`);
  }
}

export function validateHandoffRollbackProof(
  proof: HandoffRollbackProof,
  approvedDatabaseName: string,
  target: ResolvedTarget,
  mapping: ExistingMapping,
): void {
  if (proof.kind === 'never_applied') {
    if (proof.explicitlyConfirmed !== true) {
      throw new PrerequisiteSeedError(
        'rollback without handoff snapshot requires explicit never-applied confirmation',
      );
    }
    return;
  }

  const snapshot = parseJson(proof.snapshotText, 'handoff snapshot');
  const lifecycle = parseJson(proof.lifecycleText, 'handoff lifecycle sidecar');
  const checksum = proof.checksumText.match(/^([a-f0-9]{64})\s+/i)?.[1];
  const actualHash = crypto
    .createHash('sha256')
    .update(proof.snapshotText, 'utf8')
    .digest('hex');
  const pre = snapshot?.mappingPre;

  if (!checksum || checksum.toLowerCase() !== actualHash.toLowerCase()) {
    throw new PrerequisiteSeedError('handoff snapshot checksum is invalid');
  }
  if (
    snapshot?.mode !== 'apply' ||
    String(snapshot.database) !== approvedDatabaseName ||
    String(snapshot.approvedDatabaseName) !== approvedDatabaseName ||
    String(snapshot.executionId) !== proof.executionId ||
    snapshot?.lifecycle?.status !== 'rolled_back' ||
    lifecycle?.status !== 'rolled_back' ||
    String(lifecycle.executionId) !== proof.executionId
  ) {
    throw new PrerequisiteSeedError(
      'handoff snapshot does not prove a completed rollback for the approved database',
    );
  }
  if (
    !pre ||
    Number(pre.id) !== Number(mapping.id) ||
    String(pre.source) !== SEED_SOURCE ||
    Number(pre.sourceCategoryId) !== target.sourceCategoryId ||
    Number(pre.canonicalCategoryId) !== target.canonicalCategoryId ||
    String(pre.genderSlice) !== SEED_GENDER_SLICE ||
    String(pre.status) !== SEED_MAPPING_STATUS ||
    pre.note !== SEED_PROVENANCE_NOTE ||
    String(pre.catSourceId) !== SEED_SOURCE_ID ||
    String(pre.canonicalName) !== SEED_CANONICAL_NAMES.leaf
  ) {
    throw new PrerequisiteSeedError(
      'handoff rollback snapshot is not bound to this exact seed row',
    );
  }
}

export async function rollbackPrerequisiteMapping(
  connection: SeedDbConnection,
  approvedDatabaseName: string,
  proof: HandoffRollbackProof,
): Promise<SeedResult> {
  await connection.beginTransaction();
  let transactionActive = true;
  try {
    const { target, existing } = await resolveForMode(
      connection,
      approvedDatabaseName,
      true,
    );
    if (!existing) {
      throw new PrerequisiteSeedError(
        'seed mapping is absent; nothing to roll back',
      );
    }
    validateHandoffRollbackProof(proof, approvedDatabaseName, target, existing);

    const [deleteResult] = await connection.query(
      `DELETE FROM source_category_mapping
       WHERE id = ? AND source = ? AND sourceCategoryId = ?
         AND canonicalCategoryId = ? AND genderSlice = ?
         AND status = ? AND reviewStatus = ? AND note = ?`,
      [
        existing.id,
        SEED_SOURCE,
        target.sourceCategoryId,
        target.canonicalCategoryId,
        SEED_GENDER_SLICE,
        SEED_MAPPING_STATUS,
        SEED_REVIEW_STATUS,
        SEED_PROVENANCE_NOTE,
      ],
    );
    if (
      Number((deleteResult as { affectedRows?: number }).affectedRows) !== 1
    ) {
      throw new PrerequisiteSeedError(
        'rollback did not delete exactly the unchanged seed row',
      );
    }

    const remaining = await rows(
      connection,
      `SELECT id FROM source_category_mapping WHERE sourceCategoryId = ? FOR UPDATE`,
      [target.sourceCategoryId],
    );
    if (remaining.length !== 0) {
      throw new PrerequisiteSeedError(
        'mapping rows remain after rollback; transaction will be reverted',
      );
    }

    await connection.commit();
    transactionActive = false;
    return {
      outcome: 'rolled_back',
      sourceCategoryId: target.sourceCategoryId,
      canonicalCategoryId: target.canonicalCategoryId,
      mappingId: Number(existing.id),
    };
  } catch (error) {
    if (transactionActive) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original failure; the operator must verify DB state.
      }
    }
    throw error;
  }
}

function parseDotEnv(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new PrerequisiteSeedError(
      'cannot read application environment file in this execution context',
    );
  }
  const parsed: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[match[1]] = value;
  }
  return parsed;
}

function loadEffectiveEnv(): Record<string, string> {
  const envPath = path.join(__dirname, '../../../../.env');
  const fileEnv = parseDotEnv(envPath);
  const result: Record<string, string> = {};
  const keys = new Set([...Object.keys(fileEnv), ...Object.keys(process.env)]);
  for (const key of keys) {
    const processValue = String(process.env[key] || '').trim();
    const fileValue = String(fileEnv[key] || '').trim();
    if (processValue && fileValue && processValue !== fileValue) {
      throw new PrerequisiteSeedError(
        `conflicting application environment value for ${key}; values withheld`,
      );
    }
    const value = processValue || fileValue;
    if (value) result[key] = value;
  }
  return result;
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function readRollbackProof(
  snapshotPath: string | undefined,
  executionId: string | undefined,
): HandoffRollbackProof {
  if (!snapshotPath) {
    if (arg('confirm-handoff-never-applied') !== 'YES') {
      throw new PrerequisiteSeedError(
        'rollback requires --snapshot and --execution-id for a verified handoff rollback, or --confirm-handoff-never-applied=YES after operator verification',
      );
    }
    return { kind: 'never_applied', explicitlyConfirmed: true };
  }
  if (!executionId) {
    throw new PrerequisiteSeedError(
      'rollback with a handoff snapshot requires --execution-id',
    );
  }
  for (const file of [
    snapshotPath,
    `${snapshotPath}.sha256`,
    `${snapshotPath}.lifecycle.json`,
  ]) {
    try {
      const info = fs.lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 2_000_000) {
        throw new PrerequisiteSeedError(
          'handoff evidence file is unsafe or too large',
        );
      }
    } catch (error) {
      if (error instanceof PrerequisiteSeedError) throw error;
      throw new PrerequisiteSeedError(
        'required handoff rollback evidence is unavailable',
      );
    }
  }
  return {
    kind: 'rolled_back',
    executionId,
    snapshotText: fs.readFileSync(snapshotPath, 'utf8'),
    checksumText: fs.readFileSync(`${snapshotPath}.sha256`, 'utf8'),
    lifecycleText: fs.readFileSync(`${snapshotPath}.lifecycle.json`, 'utf8'),
  };
}

async function main(): Promise<void> {
  const mode = arg('mode');
  const approvedDatabaseName = arg('approved-database-name');
  if (!approvedDatabaseName || !/^[A-Za-z0-9_]+$/.test(approvedDatabaseName)) {
    throw new PrerequisiteSeedError(
      'supply the exact approved database with --approved-database-name=<name>',
    );
  }
  if (mode !== 'dry-run' && mode !== 'seed' && mode !== 'rollback') {
    throw new PrerequisiteSeedError('supply --mode=dry-run|seed|rollback');
  }
  if (
    (mode === 'seed' || mode === 'rollback') &&
    arg('i-approve-write') !== 'YES'
  ) {
    throw new PrerequisiteSeedError(`${mode} requires --i-approve-write=YES`);
  }

  const env = loadEffectiveEnv();
  if (env.DATABASE_NAME && env.DATABASE_NAME !== approvedDatabaseName) {
    throw new PrerequisiteSeedError(
      'configured database name does not match approved database name',
    );
  }
  if (!env.DATABASE_USERNAME || !env.DATABASE_PASSWORD) {
    throw new PrerequisiteSeedError(
      'application database username/password are unavailable in this execution context',
    );
  }

  const connection = await mysql.createConnection({
    host: env.DATABASE_HOST || '127.0.0.1',
    port: Number(env.DATABASE_PORT || 3306),
    user: env.DATABASE_USERNAME,
    password: env.DATABASE_PASSWORD,
    database: approvedDatabaseName,
    multipleStatements: false,
    charset: 'utf8mb4',
  });

  try {
    let result: SeedResult;
    if (mode === 'dry-run') {
      result = await dryRunPrerequisiteSeed(connection, approvedDatabaseName);
    } else if (mode === 'seed') {
      result = await seedPrerequisiteMapping(connection, approvedDatabaseName);
    } else {
      const proof = readRollbackProof(arg('snapshot'), arg('execution-id'));
      result = await rollbackPrerequisiteMapping(
        connection,
        approvedDatabaseName,
        proof,
      );
    }
    process.stdout.write(
      `${JSON.stringify(
        { ok: true, mode, database: approvedDatabaseName, ...result },
        null,
        2,
      )}\n`,
    );
  } finally {
    try {
      await connection.end();
    } catch {
      process.stderr.write(
        'warning: database connection close failed; operation result is reported above\n',
      );
    }
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message =
      error instanceof PrerequisiteSeedError
        ? error.message
        : 'database seed operation failed; sensitive connection details withheld';
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: message }, null, 2)}\n`,
    );
    process.exitCode = 1;
  });
}
