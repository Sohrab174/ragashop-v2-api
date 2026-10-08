/**
 * SCOPE-7 — additive SAFE_TO_ADD canonical leaves only.
 *
 * Idempotent. Does NOT create/update source_category_mapping rows.
 * Does NOT rename existing categories. Skips labels that already exist
 * under the intended parent (e.g. women's لباس راحتی).
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/database/seeds/phase-scope7-safe-canonical-leaves.seed.ts
 */

import { createConnection, Connection } from 'typeorm';
import * as path from 'path';

type LeafAdd = {
  rootName: string;
  familyName: string;
  name: string;
};

/** SAFE_TO_ADD from forensic phase — no furniture/home/kids deferred items. */
export const SCOPE7_SAFE_LEAVES: LeafAdd[] = [
  // Women / Clothing
  { rootName: 'زنانه', familyName: 'پوشاک', name: 'شلوار' },
  { rootName: 'زنانه', familyName: 'پوشاک', name: 'ست لباس' },
  { rootName: 'زنانه', familyName: 'پوشاک', name: 'لباس شنا' },
  { rootName: 'زنانه', familyName: 'پوشاک', name: 'لباس زیر' },
  { rootName: 'زنانه', familyName: 'پوشاک', name: 'شلوارک' },
  { rootName: 'زنانه', familyName: 'پوشاک', name: 'جوراب' },
  { rootName: 'زنانه', familyName: 'پوشاک', name: 'سرهمی' },
  // Men / Clothing
  { rootName: 'مردانه', familyName: 'پوشاک', name: 'شلوار' },
  { rootName: 'مردانه', familyName: 'پوشاک', name: 'ست لباس' },
  { rootName: 'مردانه', familyName: 'پوشاک', name: 'لباس شنا' },
  { rootName: 'مردانه', familyName: 'پوشاک', name: 'لباس زیر' },
  { rootName: 'مردانه', familyName: 'پوشاک', name: 'شلوارک' },
  { rootName: 'مردانه', familyName: 'پوشاک', name: 'جوراب' },
  { rootName: 'مردانه', familyName: 'پوشاک', name: 'کت‌وشلوار' },
  { rootName: 'مردانه', familyName: 'پوشاک', name: 'لباس راحتی' },
  // Men / Shoes
  { rootName: 'مردانه', familyName: 'کفش', name: 'صندل' },
  { rootName: 'مردانه', familyName: 'کفش', name: 'دمپایی' },
  // Men / Bags (wallet matches women: under کیف, not اکسسوری)
  { rootName: 'مردانه', familyName: 'کیف', name: 'کیف پول' },
  // Men / Accessories
  { rootName: 'مردانه', familyName: 'اکسسوری', name: 'کلاه و شال' },
];

async function loadOrmConfig(): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(__dirname, '../../../ormconfig.json'));
}

async function findRoot(
  conn: Connection,
  name: string,
): Promise<{ id: number } | null> {
  const rows = await conn.query(
    `SELECT id FROM canonical_category
     WHERE parentId IS NULL AND name = ? AND isLocalPrototype = 1
     ORDER BY id ASC LIMIT 1`,
    [name],
  );
  return rows[0] ?? null;
}

async function findFamily(
  conn: Connection,
  rootId: number,
  name: string,
): Promise<{ id: number } | null> {
  const rows = await conn.query(
    `SELECT id FROM canonical_category
     WHERE parentId = ? AND name = ? AND isLocalPrototype = 1
     ORDER BY id ASC LIMIT 1`,
    [rootId, name],
  );
  return rows[0] ?? null;
}

async function nextDisplayOrder(
  conn: Connection,
  parentId: number,
): Promise<number> {
  const rows = await conn.query(
    `SELECT COALESCE(MAX(displayOrder), 0) AS maxOrd
     FROM canonical_category WHERE parentId = ?`,
    [parentId],
  );
  return Number(rows[0]?.maxOrd ?? 0) + 1;
}

export async function addScope7SafeCanonicalLeaves(
  connection?: Connection,
): Promise<{
  created: Array<{ id: number; parentId: number; name: string; root: string; family: string }>;
  skippedExisting: string[];
  missingParents: string[];
}> {
  const ownsConnection = !connection;
  const conn =
    connection ||
    (await createConnection({
      ...(await loadOrmConfig()),
      entities: [],
      migrations: [],
      synchronize: false,
      logging: false,
    }));

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const created: Array<{
    id: number;
    parentId: number;
    name: string;
    root: string;
    family: string;
  }> = [];
  const skippedExisting: string[] = [];
  const missingParents: string[] = [];

  try {
    for (const leaf of SCOPE7_SAFE_LEAVES) {
      const root = await findRoot(conn, leaf.rootName);
      if (!root) {
        missingParents.push(`${leaf.rootName}`);
        continue;
      }
      const family = await findFamily(conn, root.id, leaf.familyName);
      if (!family) {
        missingParents.push(`${leaf.rootName}/${leaf.familyName}`);
        continue;
      }

      const existing = await conn.query(
        `SELECT id FROM canonical_category
         WHERE parentId = ? AND name = ? AND isLocalPrototype = 1
         ORDER BY id ASC LIMIT 1`,
        [family.id, leaf.name],
      );
      if (existing[0]?.id) {
        skippedExisting.push(
          `${leaf.rootName}/${leaf.familyName}/${leaf.name}#${existing[0].id}`,
        );
        continue;
      }

      const displayOrder = await nextDisplayOrder(conn, family.id);
      const result = await conn.query(
        `INSERT INTO canonical_category
          (parentId, name, status, displayOrder, imagePath, discoveryImagePath, audience, isLocalPrototype, createdAt, updatedAt)
         VALUES (?, ?, 'active', ?, NULL, NULL, NULL, 1, ?, ?)`,
        [family.id, leaf.name, displayOrder, now, now],
      );
      created.push({
        id: Number(result.insertId),
        parentId: family.id,
        name: leaf.name,
        root: leaf.rootName,
        family: leaf.familyName,
      });
    }

    return { created, skippedExisting, missingParents };
  } finally {
    if (ownsConnection) await conn.close();
  }
}

if (require.main === module) {
  addScope7SafeCanonicalLeaves()
    .then((result) => {
      console.log('[SCOPE-7 safe leaves]', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
