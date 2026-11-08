import * as crypto from 'crypto';
import {
  dryRunPrerequisiteSeed,
  HandoffRollbackProof,
  rollbackPrerequisiteMapping,
  SEED_CANONICAL_NAMES,
  SEED_MAPPING_STATUS,
  SEED_PROVENANCE_NOTE,
  SEED_REVIEW_STATUS,
  SEED_SOURCE,
  SEED_SOURCE_HIERARCHY,
  SEED_SOURCE_ID,
  SEED_SOURCE_NAME,
  seedPrerequisiteMapping,
  SeedDbConnection,
} from './prerequisite-seed';

const DB_NAME = 'online_shop';

type FixtureOptions = {
  canonicalRows?: any[];
  mappings?: any[];
  failAfterInsert?: boolean;
};

function fixture(options: FixtureOptions = {}) {
  const source = {
    id: 831,
    source: SEED_SOURCE,
    sourceId: SEED_SOURCE_ID,
    sourceName: SEED_SOURCE_NAME,
    hierarchy: SEED_SOURCE_HIERARCHY,
    status: 'active',
  };
  const canonical = {
    canonicalCategoryId: 972,
    rootName: SEED_CANONICAL_NAMES.root,
    rootStatus: 'active',
    rootParentId: null,
    parentName: SEED_CANONICAL_NAMES.parent,
    parentStatus: 'active',
    leafName: SEED_CANONICAL_NAMES.leaf,
    leafStatus: 'active',
  };
  const mappings = [...(options.mappings || [])];
  let nextId = 12_345;
  const query = jest.fn(async (rawSql: string, values: unknown[] = []) => {
    const sql = rawSql.replace(/\s+/g, ' ').trim();
    if (sql.includes('SELECT DATABASE() AS db')) {
      return [[{ db: DB_NAME }], []];
    }
    if (sql.includes('FROM information_schema.tables')) {
      return [
        [
          { tableName: 'category', engine: 'InnoDB' },
          { tableName: 'canonical_category', engine: 'InnoDB' },
          { tableName: 'source_category_mapping', engine: 'InnoDB' },
        ],
        [],
      ];
    }
    if (sql.includes('FROM information_schema.columns')) {
      return [
        [
          ...[
            'id',
            'source',
            'sourceId',
            'sourceName',
            'hierarchy',
            'status',
          ].map((columnName) => ({ tableName: 'category', columnName })),
          ...['id', 'parentId', 'name', 'status'].map((columnName) => ({
            tableName: 'canonical_category',
            columnName,
          })),
          ...[
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
          ].map((columnName) => ({
            tableName: 'source_category_mapping',
            columnName,
          })),
        ],
        [],
      ];
    }
    if (sql.includes('FROM information_schema.statistics')) {
      return [
        [
          { columnName: 'sourceCategoryId', seqInIndex: 1, nonUnique: 0 },
          { columnName: 'genderSlice', seqInIndex: 2, nonUnique: 0 },
        ],
        [],
      ];
    }
    if (sql.includes('FROM category') && sql.includes('sourceId = ?')) {
      return [[source], []];
    }
    if (sql.includes('FROM canonical_category AS root')) {
      return [options.canonicalRows || [canonical], []];
    }
    if (
      sql.includes('FROM source_category_mapping') &&
      sql.includes('WHERE sourceCategoryId = ?')
    ) {
      return [mappings.filter((row) => row.sourceCategoryId === values[0]), []];
    }
    if (sql.includes('FROM source_category_mapping WHERE id = ? FOR UPDATE')) {
      if (options.failAfterInsert) throw new Error('verification read failed');
      return [mappings.filter((row) => row.id === values[0]), []];
    }
    if (sql.startsWith('INSERT INTO source_category_mapping')) {
      const row = {
        id: nextId++,
        source: values[0],
        sourceCategoryId: values[1],
        canonicalCategoryId: values[2],
        genderSlice: 'any',
        status: SEED_MAPPING_STATUS,
        reviewStatus: SEED_REVIEW_STATUS,
        note: values[3],
      };
      mappings.push(row);
      if (options.failAfterInsert)
        return [{ affectedRows: 1, insertId: row.id }, []];
      return [{ affectedRows: 1, insertId: row.id }, []];
    }
    if (sql.startsWith('DELETE FROM source_category_mapping')) {
      const before = mappings.length;
      for (let index = mappings.length - 1; index >= 0; index -= 1) {
        const row = mappings[index];
        if (
          row.id === values[0] &&
          row.source === values[1] &&
          row.sourceCategoryId === values[2] &&
          row.canonicalCategoryId === values[3] &&
          row.genderSlice === values[4] &&
          row.status === values[5] &&
          row.reviewStatus === values[6] &&
          row.note === values[7]
        ) {
          mappings.splice(index, 1);
        }
      }
      return [{ affectedRows: before - mappings.length }, []];
    }
    if (
      sql.includes(
        'SELECT id FROM source_category_mapping WHERE sourceCategoryId = ? FOR UPDATE',
      )
    ) {
      return [mappings.filter((row) => row.sourceCategoryId === values[0]), []];
    }
    throw new Error(`Unexpected query in test: ${sql}`);
  });

  const connection: SeedDbConnection = {
    query: query as unknown as SeedDbConnection['query'],
    beginTransaction: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
  };
  return { connection, query, mappings, source, canonical };
}

function exactMapping(source: any, canonical: any) {
  return {
    id: 77,
    source: SEED_SOURCE,
    sourceCategoryId: source.id,
    canonicalCategoryId: canonical.canonicalCategoryId,
    genderSlice: 'any',
    status: SEED_MAPPING_STATUS,
    reviewStatus: SEED_REVIEW_STATUS,
    note: SEED_PROVENANCE_NOTE,
  };
}

function validRollbackProof(
  mapping: any,
  canonical: any,
): HandoffRollbackProof {
  const snapshot = {
    mode: 'apply',
    database: DB_NAME,
    approvedDatabaseName: DB_NAME,
    executionId: 'catalog-handoff-test-1',
    lifecycle: {
      status: 'rolled_back',
      rolledBackAt: '2026-11-08T00:00:00.000Z',
    },
    mappingPre: {
      id: mapping.id,
      source: mapping.source,
      sourceCategoryId: mapping.sourceCategoryId,
      canonicalCategoryId: mapping.canonicalCategoryId,
      genderSlice: mapping.genderSlice,
      status: mapping.status,
      note: mapping.note,
      catSourceId: SEED_SOURCE_ID,
      canonicalName: canonical.leafName,
    },
  };
  const snapshotText = JSON.stringify(snapshot, null, 2);
  const hash = crypto
    .createHash('sha256')
    .update(snapshotText, 'utf8')
    .digest('hex');
  return {
    kind: 'rolled_back',
    executionId: snapshot.executionId,
    snapshotText,
    checksumText: `${hash}  test.snapshot.json\n`,
    lifecycleText: JSON.stringify({
      executionId: snapshot.executionId,
      status: 'rolled_back',
    }),
  };
}

describe('catalog handoff Kombinezon prerequisite seed', () => {
  it('dry-run reports readiness without writing', async () => {
    const { connection, query } = fixture();

    await expect(dryRunPrerequisiteSeed(connection, DB_NAME)).resolves.toEqual({
      outcome: 'ready_to_seed',
      sourceCategoryId: 831,
      canonicalCategoryId: 972,
    });

    expect(query).not.toHaveBeenCalledWith(
      expect.stringMatching(/^INSERT INTO source_category_mapping/i),
      expect.anything(),
    );
    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });

  it('inserts one inactive any-slice mapping using database-derived IDs', async () => {
    const { connection, query } = fixture();

    const result = await seedPrerequisiteMapping(connection, DB_NAME);

    expect(result).toEqual({
      outcome: 'seeded',
      sourceCategoryId: 831,
      canonicalCategoryId: 972,
      mappingId: 12_345,
    });
    const insert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO source_category_mapping'),
    );
    expect(insert?.[1]).toEqual([SEED_SOURCE, 831, 972, SEED_PROVENANCE_NOTE]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('fails closed on duplicate or conflicting existing mappings', async () => {
    const conflict = fixture();
    conflict.mappings.push({
      ...exactMapping(conflict.source, conflict.canonical),
      note: 'manual mapping without seed provenance',
    });
    const duplicate = fixture();
    duplicate.mappings.push(
      exactMapping(duplicate.source, duplicate.canonical),
      {
        ...exactMapping(duplicate.source, duplicate.canonical),
        id: 78,
        genderSlice: 'female',
      },
    );

    for (const current of [conflict, duplicate]) {
      await expect(
        seedPrerequisiteMapping(current.connection, DB_NAME),
      ).rejects.toThrow(/conflicting, changed, or duplicate mapping/);
      expect(
        current.query.mock.calls.some(([sql]) =>
          String(sql).startsWith('INSERT'),
        ),
      ).toBe(false);
      expect(current.connection.rollback).toHaveBeenCalledTimes(1);
      expect(current.connection.commit).not.toHaveBeenCalled();
    }
  });

  it('fails closed when the active canonical path is missing or ambiguous', async () => {
    for (const canonicalRows of [[], [{ id: 1 }, { id: 2 }]]) {
      const { connection, query } = fixture({ canonicalRows });
      await expect(
        seedPrerequisiteMapping(connection, DB_NAME),
      ).rejects.toThrow(/active women underwear canonical path/);
      expect(
        query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT')),
      ).toBe(false);
      expect(connection.rollback).toHaveBeenCalledTimes(1);
    }
  });

  it('rolls back a partial insert failure and preserves the primary error', async () => {
    const { connection } = fixture({ failAfterInsert: true });

    await expect(seedPrerequisiteMapping(connection, DB_NAME)).rejects.toThrow(
      'verification read failed',
    );
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('reports already-applied only for the exact seed provenance and identity', async () => {
    const initial = fixture();
    initial.mappings.push(exactMapping(initial.source, initial.canonical));

    await expect(
      seedPrerequisiteMapping(initial.connection, DB_NAME),
    ).resolves.toEqual({
      outcome: 'already_applied',
      sourceCategoryId: 831,
      canonicalCategoryId: 972,
      mappingId: 77,
    });
    expect(
      initial.query.mock.calls.some(([sql]) =>
        String(sql).startsWith('INSERT'),
      ),
    ).toBe(false);
    expect(initial.connection.commit).toHaveBeenCalledTimes(1);
  });

  it('rolls back only the exact seed row after verified handoff rollback', async () => {
    const { connection, mappings, source, canonical } = fixture();
    const mapping = exactMapping(source, canonical);
    mappings.push(mapping);

    await expect(
      rollbackPrerequisiteMapping(
        connection,
        DB_NAME,
        validRollbackProof(mapping, canonical),
      ),
    ).resolves.toEqual({
      outcome: 'rolled_back',
      sourceCategoryId: 831,
      canonicalCategoryId: 972,
      mappingId: 77,
    });
    expect(mappings).toHaveLength(0);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it('refuses rollback when the seed row changed or handoff is not rolled back', async () => {
    const changed = fixture();
    changed.mappings.push({
      ...exactMapping(changed.source, changed.canonical),
      status: 'active',
    });
    await expect(
      rollbackPrerequisiteMapping(changed.connection, DB_NAME, {
        kind: 'never_applied',
        explicitlyConfirmed: true,
      }),
    ).rejects.toThrow(/conflicting, changed, or duplicate/);
    expect(changed.connection.rollback).toHaveBeenCalledTimes(1);

    const pending = fixture();
    const pendingMapping = exactMapping(pending.source, pending.canonical);
    pending.mappings.push(pendingMapping);
    const proof = validRollbackProof(pendingMapping, pending.canonical);
    if (proof.kind === 'rolled_back') {
      const snapshot = JSON.parse(proof.snapshotText);
      snapshot.lifecycle.status = 'ready_for_rollback';
      proof.snapshotText = JSON.stringify(snapshot, null, 2);
      const hash = crypto
        .createHash('sha256')
        .update(proof.snapshotText, 'utf8')
        .digest('hex');
      proof.checksumText = `${hash}  test.snapshot.json\n`;
    }
    await expect(
      rollbackPrerequisiteMapping(pending.connection, DB_NAME, proof),
    ).rejects.toThrow(/completed rollback/);
    expect(pending.mappings).toHaveLength(1);
    expect(pending.connection.rollback).toHaveBeenCalledTimes(1);
    expect(pending.connection.commit).not.toHaveBeenCalled();
  });
});
