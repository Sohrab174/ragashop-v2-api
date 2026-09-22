/**
 * LOCAL DEVELOPMENT / UX PROTOTYPE CANONICAL TAXONOMY
 *
 * NOT authoritative production taxonomy.
 * Easy to edit/replace later from Admin/database.
 * Rows are marked isLocalPrototype = 1.
 *
 * Run after migration:
 *   npx ts-node -r tsconfig-paths/register src/database/seeds/phase-c1-local-canonical-taxonomy.seed.ts
 */

import { createConnection, Connection } from 'typeorm';
import * as path from 'path';

const ROOTS: Array<{
  key: string;
  name: string;
  displayOrder: number;
  audience?: string;
  children?: Array<{ key: string; name: string; displayOrder: number }>;
}> = [
  {
    key: 'women',
    name: 'زنانه',
    displayOrder: 1,
    audience: 'female',
    children: [
      { key: 'women-apparel', name: 'پوشاک', displayOrder: 1 },
      { key: 'women-shoes', name: 'کفش', displayOrder: 2 },
      { key: 'women-bags', name: 'کیف', displayOrder: 3 },
      { key: 'women-accessories', name: 'اکسسوری', displayOrder: 4 },
    ],
  },
  {
    key: 'men',
    name: 'مردانه',
    displayOrder: 2,
    audience: 'male',
    children: [
      { key: 'men-apparel', name: 'پوشاک', displayOrder: 1 },
      { key: 'men-shoes', name: 'کفش', displayOrder: 2 },
      { key: 'men-bags', name: 'کیف', displayOrder: 3 },
      { key: 'men-accessories', name: 'اکسسوری', displayOrder: 4 },
    ],
  },
  {
    key: 'kids',
    name: 'بچگانه',
    displayOrder: 3,
    audience: 'child',
    children: [
      { key: 'kids-apparel', name: 'پوشاک', displayOrder: 1 },
      { key: 'kids-shoes', name: 'کفش', displayOrder: 2 },
    ],
  },
  { key: 'beauty', name: 'زیبایی', displayOrder: 4 },
  { key: 'home', name: 'خانه و زندگی', displayOrder: 5 },
  { key: 'electronics', name: 'الکترونیک', displayOrder: 6 },
  { key: 'sports', name: 'ورزش', displayOrder: 7 },
];

/**
 * Explicit LOCAL development mappings only (no heuristics / mass mapping).
 * sourceCategoryId = existing imported category.id
 */
const DEV_MAPPINGS: Array<{
  source: string;
  sourceCategoryId: number;
  canonicalKey: string;
  note: string;
}> = [
  {
    source: 'trendyol',
    sourceCategoryId: 36,
    canonicalKey: 'electronics',
    note: 'C1 local proof: Trendyol الکترونیک → canonical الکترونیک',
  },
  {
    source: 'trendyol',
    sourceCategoryId: 44,
    canonicalKey: 'sports',
    note: 'C1 local proof: Trendyol ورزشی و بیرون‌از‌منزل → canonical ورزش',
  },
  {
    source: 'trendyol',
    sourceCategoryId: 186,
    canonicalKey: 'beauty',
    note: 'C1 local proof: Trendyol لوازم آرایشی → canonical زیبایی',
  },
  {
    source: 'trendyol',
    sourceCategoryId: 2,
    canonicalKey: 'women-apparel',
    note: 'C1 local proof: Trendyol لباس root → canonical زنانه/پوشاک (prototype only)',
  },
];

async function loadOrmConfig(): Promise<any> {
  const ormPath = path.join(__dirname, '../../../ormconfig.json');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(ormPath);
}

export async function seedLocalCanonicalTaxonomy(
  connection?: Connection,
): Promise<{
  roots: string[];
  children: string[];
  mappings: Array<{ sourceCategoryId: number; canonicalName: string }>;
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

  try {
    const existing = await conn.query(
      `SELECT COUNT(*) AS cnt FROM canonical_category WHERE isLocalPrototype = 1`,
    );
    const count = Number(existing[0]?.cnt ?? 0);
    if (count > 0) {
      console.log(
        `[C1 seed] Skipping insert — ${count} local prototype canonical rows already exist.`,
      );
      const roots = await conn.query(
        `SELECT name FROM canonical_category WHERE parentId IS NULL AND isLocalPrototype = 1 ORDER BY displayOrder, id`,
      );
      const children = await conn.query(
        `SELECT name FROM canonical_category WHERE parentId IS NOT NULL AND isLocalPrototype = 1 ORDER BY displayOrder, id`,
      );
      const mappings = await conn.query(
        `SELECT m.sourceCategoryId, c.name AS canonicalName
         FROM source_category_mapping m
         JOIN canonical_category c ON c.id = m.canonicalCategoryId
         WHERE m.note LIKE 'C1 local proof:%'
         ORDER BY m.id`,
      );
      return {
        roots: roots.map((r: any) => r.name),
        children: children.map((r: any) => r.name),
        mappings: mappings.map((m: any) => ({
          sourceCategoryId: m.sourceCategoryId,
          canonicalName: m.canonicalName,
        })),
      };
    }

    const keyToId = new Map<string, number>();
    const createdRoots: string[] = [];
    const createdChildren: string[] = [];

    for (const root of ROOTS) {
      const result = await conn.query(
        `INSERT INTO canonical_category
          (parentId, name, status, displayOrder, imagePath, audience, isLocalPrototype, createdAt, updatedAt)
         VALUES (NULL, ?, 'active', ?, NULL, ?, 1, ?, ?)`,
        [root.name, root.displayOrder, root.audience ?? null, now, now],
      );
      const rootId = Number(result.insertId);
      keyToId.set(root.key, rootId);
      createdRoots.push(root.name);

      for (const child of root.children ?? []) {
        const childResult = await conn.query(
          `INSERT INTO canonical_category
            (parentId, name, status, displayOrder, imagePath, audience, isLocalPrototype, createdAt, updatedAt)
           VALUES (?, ?, 'active', ?, NULL, ?, 1, ?, ?)`,
          [
            rootId,
            child.name,
            child.displayOrder,
            root.audience ?? null,
            now,
            now,
          ],
        );
        keyToId.set(child.key, Number(childResult.insertId));
        createdChildren.push(`${root.name} → ${child.name}`);
      }
    }

    const createdMappings: Array<{
      sourceCategoryId: number;
      canonicalName: string;
    }> = [];

    for (const mapping of DEV_MAPPINGS) {
      const canonicalId = keyToId.get(mapping.canonicalKey);
      if (!canonicalId) {
        throw new Error(`Missing canonical key ${mapping.canonicalKey}`);
      }

      const sourceExists = await conn.query(
        `SELECT id, name FROM category WHERE id = ? LIMIT 1`,
        [mapping.sourceCategoryId],
      );
      if (!sourceExists.length) {
        console.warn(
          `[C1 seed] Skip mapping — source category ${mapping.sourceCategoryId} not found`,
        );
        continue;
      }

      await conn.query(
        `INSERT INTO source_category_mapping
          (source, sourceCategoryId, canonicalCategoryId, status, note, createdAt, updatedAt)
         VALUES (?, ?, ?, 'active', ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           source = VALUES(source),
           canonicalCategoryId = VALUES(canonicalCategoryId),
           status = VALUES(status),
           note = VALUES(note)`,
        [
          mapping.source,
          mapping.sourceCategoryId,
          canonicalId,
          mapping.note,
          now,
          now,
        ],
      );

      createdMappings.push({
        sourceCategoryId: mapping.sourceCategoryId,
        canonicalName: sourceExists[0].name
          ? `${sourceExists[0].name} → ${
              ROOTS.flatMap((r) => [
                { key: r.key, name: r.name },
                ...(r.children ?? []).map((c) => ({
                  key: c.key,
                  name: `${r.name}/${c.name}`,
                })),
              ]).find((x) => x.key === mapping.canonicalKey)?.name ??
              mapping.canonicalKey
            }`
          : mapping.canonicalKey,
      });
    }

    console.log(
      '[C1 seed] LOCAL DEVELOPMENT / UX PROTOTYPE CANONICAL TAXONOMY',
    );
    console.log('[C1 seed] Roots:', createdRoots.join(', '));
    console.log('[C1 seed] Children:', createdChildren.length);
    console.log('[C1 seed] Mappings:', createdMappings.length);

    return {
      roots: createdRoots,
      children: createdChildren,
      mappings: createdMappings,
    };
  } finally {
    if (ownsConnection) {
      await conn.close();
    }
  }
}

if (require.main === module) {
  seedLocalCanonicalTaxonomy()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
