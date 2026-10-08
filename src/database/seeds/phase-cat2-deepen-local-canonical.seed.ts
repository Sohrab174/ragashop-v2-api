/**
 * CAT-2 — deepen LOCAL prototype canonical taxonomy to ROOT → FAMILY → LEAF.
 *
 * Idempotent. Additive for taxonomy structure.
 * CAT-3B: kids must NOT reclaim over-broad Clothing/Shoes source mappings;
 * seed reconciles by deactivating those specific historically seeded rows.
 * Does not remapping existing products. Preserves CAT-2 presentation/images.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/database/seeds/phase-cat2-deepen-local-canonical.seed.ts
 */

import { createConnection, Connection } from 'typeorm';
import * as path from 'path';

type LeafSpec = {
  name: string;
  displayOrder: number;
  /** Optional source category id for PLP mapping (additive upsert). */
  sourceCategoryId?: number;
};

type FamilySpec = {
  name: string;
  displayOrder: number;
  leaves: LeafSpec[];
  sourceCategoryId?: number;
};

type RootSpec = {
  name: string;
  families: FamilySpec[];
};

/**
 * Structure-only labels for local prototype depth.
 * Mappings use imported source category ids where they exist.
 *
 * CAT-3B — over-broad sources that must never be (re)mapped under بچگانه.
 * Matches approved removals: Clothing(2), T-Shirt(17), Shoes(79),
 * Spor Ayakkabı(80), Sandalet(148). Bebek(339) and Set(200) remain allowed.
 */
export const CAT3B_FORBIDDEN_KIDS_SOURCE_CATEGORY_IDS = [
  2, 17, 79, 80, 148,
] as const;

const DEEPEN: RootSpec[] = [
  {
    name: 'زنانه',
    families: [
      {
        name: 'پوشاک',
        displayOrder: 1,
        sourceCategoryId: 2,
        leaves: [
          { name: 'پیراهن', displayOrder: 1, sourceCategoryId: 18 },
          { name: 'تیشرت', displayOrder: 2, sourceCategoryId: 17 },
          { name: 'بلوز', displayOrder: 3, sourceCategoryId: 13 },
          { name: 'شلوار جین', displayOrder: 4, sourceCategoryId: 19 },
          { name: 'دامن', displayOrder: 5, sourceCategoryId: 25 },
          { name: 'کت و مانتو', displayOrder: 6, sourceCategoryId: 22 },
          { name: 'سویشرت', displayOrder: 7, sourceCategoryId: 16 },
          { name: 'لباس مجلسی', displayOrder: 8, sourceCategoryId: 564 },
          { name: 'لباس راحتی', displayOrder: 9, sourceCategoryId: 4 },
          { name: 'پلیور و ژاکت', displayOrder: 10, sourceCategoryId: 26 },
          // SCOPE-7 SAFE_TO_ADD (no source mapping here — Auto-map proposes)
          { name: 'شلوار', displayOrder: 11 },
          { name: 'ست لباس', displayOrder: 12 },
          { name: 'لباس شنا', displayOrder: 13 },
          { name: 'لباس زیر', displayOrder: 14 },
          { name: 'شلوارک', displayOrder: 15 },
          { name: 'جوراب', displayOrder: 16 },
          { name: 'سرهمی', displayOrder: 17 },
        ],
      },
      {
        name: 'کفش',
        displayOrder: 2,
        sourceCategoryId: 79,
        leaves: [
          { name: 'کفش ورزشی', displayOrder: 1, sourceCategoryId: 80 },
          { name: 'بوت و چکمه', displayOrder: 2, sourceCategoryId: 87 },
          { name: 'کفش روزمره', displayOrder: 3, sourceCategoryId: 145 },
          { name: 'صندل و دمپایی', displayOrder: 4, sourceCategoryId: 148 },
          { name: 'کفش پاشنه بلند', displayOrder: 5, sourceCategoryId: 215 },
        ],
      },
      {
        name: 'کیف',
        displayOrder: 3,
        sourceCategoryId: 114,
        leaves: [
          { name: 'کیف', displayOrder: 1, sourceCategoryId: 114 },
          { name: 'کیف پول', displayOrder: 2, sourceCategoryId: 116 },
        ],
      },
      {
        name: 'اکسسوری',
        displayOrder: 4,
        sourceCategoryId: 106,
        leaves: [
          { name: 'ساعت', displayOrder: 1, sourceCategoryId: 128 },
          { name: 'عینک', displayOrder: 2, sourceCategoryId: 126 },
          { name: 'جواهرات', displayOrder: 3, sourceCategoryId: 219 },
          { name: 'کلاه و شال', displayOrder: 4, sourceCategoryId: 107 },
        ],
      },
    ],
  },
  {
    name: 'مردانه',
    families: [
      {
        name: 'پوشاک',
        displayOrder: 1,
        sourceCategoryId: 2,
        leaves: [
          { name: 'تیشرت', displayOrder: 1, sourceCategoryId: 17 },
          { name: 'پیراهن', displayOrder: 2, sourceCategoryId: 18 },
          { name: 'شلوار جین', displayOrder: 3, sourceCategoryId: 19 },
          { name: 'کت و مانتو', displayOrder: 4, sourceCategoryId: 22 },
          { name: 'سویشرت', displayOrder: 5, sourceCategoryId: 16 },
          { name: 'پلیور و ژاکت', displayOrder: 6, sourceCategoryId: 26 },
          // SCOPE-7 SAFE_TO_ADD (no source mapping here — Auto-map proposes)
          { name: 'شلوار', displayOrder: 7 },
          { name: 'ست لباس', displayOrder: 8 },
          { name: 'لباس شنا', displayOrder: 9 },
          { name: 'لباس زیر', displayOrder: 10 },
          { name: 'شلوارک', displayOrder: 11 },
          { name: 'جوراب', displayOrder: 12 },
          { name: 'کت‌وشلوار', displayOrder: 13 },
          { name: 'لباس راحتی', displayOrder: 14 },
        ],
      },
      {
        name: 'کفش',
        displayOrder: 2,
        sourceCategoryId: 79,
        leaves: [
          { name: 'کفش ورزشی', displayOrder: 1, sourceCategoryId: 80 },
          { name: 'کفش روزمره', displayOrder: 2, sourceCategoryId: 145 },
          { name: 'بوت و چکمه', displayOrder: 3, sourceCategoryId: 87 },
          { name: 'صندل', displayOrder: 4 },
          { name: 'دمپایی', displayOrder: 5 },
        ],
      },
      {
        name: 'کیف',
        displayOrder: 3,
        sourceCategoryId: 114,
        leaves: [
          { name: 'کیف', displayOrder: 1, sourceCategoryId: 114 },
          { name: 'کیف پول', displayOrder: 2 },
        ],
      },
      {
        name: 'اکسسوری',
        displayOrder: 4,
        sourceCategoryId: 106,
        leaves: [
          { name: 'ساعت', displayOrder: 1, sourceCategoryId: 128 },
          { name: 'عینک', displayOrder: 2, sourceCategoryId: 126 },
          { name: 'کلاه و شال', displayOrder: 3 },
        ],
      },
    ],
  },
  {
    name: 'بچگانه',
    families: [
      {
        name: 'پوشاک',
        displayOrder: 1,
        // CAT-3B: do NOT map broad Clothing (2) or gender-flat T-Shirt (17)
        // under kids — those inject adult catalogs. Keep Bebek + ambiguous set.
        leaves: [
          { name: 'تیشرت', displayOrder: 1 },
          { name: 'لباس نوزاد', displayOrder: 2, sourceCategoryId: 339 },
          { name: 'ست دو تیکه', displayOrder: 3, sourceCategoryId: 200 },
        ],
      },
      {
        name: 'کفش',
        displayOrder: 2,
        // CAT-3B: do NOT map broad Shoes (79) / Spor Ayakkabı (80) / Sandalet (148)
        // under kids — over-broad adult shoe trees.
        leaves: [
          { name: 'کفش ورزشی', displayOrder: 1 },
          { name: 'صندل و دمپایی', displayOrder: 2 },
        ],
      },
    ],
  },
  {
    name: 'زیبایی',
    families: [
      {
        name: 'آرایش',
        displayOrder: 1,
        sourceCategoryId: 187,
        leaves: [
          { name: 'رژ لب', displayOrder: 1, sourceCategoryId: 197 },
          { name: 'آرایش چشم', displayOrder: 2, sourceCategoryId: 195 },
          { name: 'تن ماکیاج', displayOrder: 3, sourceCategoryId: 188 },
          { name: 'ناخن', displayOrder: 4, sourceCategoryId: 390 },
        ],
      },
      {
        name: 'مراقبت پوست',
        displayOrder: 2,
        sourceCategoryId: 419,
        leaves: [
          { name: 'مراقبت پوست', displayOrder: 1, sourceCategoryId: 419 },
        ],
      },
      {
        name: 'مراقبت مو',
        displayOrder: 3,
        sourceCategoryId: 484,
        leaves: [{ name: 'مراقبت مو', displayOrder: 1, sourceCategoryId: 484 }],
      },
    ],
  },
  {
    name: 'الکترونیک',
    families: [
      {
        name: 'هدفون',
        displayOrder: 1,
        sourceCategoryId: 37,
        leaves: [
          { name: 'هدفون بلوتوث', displayOrder: 1, sourceCategoryId: 38 },
          { name: 'هدفون', displayOrder: 2, sourceCategoryId: 37 },
        ],
      },
      {
        name: 'تلفن',
        displayOrder: 2,
        sourceCategoryId: 53,
        leaves: [{ name: 'تلفن', displayOrder: 1, sourceCategoryId: 53 }],
      },
      {
        name: 'کامپیوتر و تبلت',
        displayOrder: 3,
        sourceCategoryId: 137,
        leaves: [
          { name: 'کامپیوتر و تبلت', displayOrder: 1, sourceCategoryId: 137 },
        ],
      },
      {
        name: 'فناوری پوشیدنی',
        displayOrder: 4,
        sourceCategoryId: 50,
        leaves: [
          { name: 'فناوری پوشیدنی', displayOrder: 1, sourceCategoryId: 50 },
        ],
      },
      {
        name: 'بازی و کنسول',
        displayOrder: 5,
        sourceCategoryId: 41,
        leaves: [
          { name: 'بازی و کنسول', displayOrder: 1, sourceCategoryId: 41 },
        ],
      },
    ],
  },
  {
    name: 'ورزش',
    families: [
      {
        name: 'لباس ورزشی',
        displayOrder: 1,
        sourceCategoryId: 89,
        leaves: [{ name: 'لباس ورزشی', displayOrder: 1, sourceCategoryId: 89 }],
      },
      {
        name: 'ابزارهای ورزشی',
        displayOrder: 2,
        sourceCategoryId: 45,
        leaves: [
          { name: 'لوازم ورزشی', displayOrder: 1, sourceCategoryId: 82 },
          { name: 'تناسب اندام', displayOrder: 2, sourceCategoryId: 171 },
          { name: 'دوچرخه', displayOrder: 3, sourceCategoryId: 74 },
        ],
      },
      {
        name: 'فضای باز',
        displayOrder: 3,
        sourceCategoryId: 61,
        leaves: [{ name: 'فضای باز', displayOrder: 1, sourceCategoryId: 61 }],
      },
    ],
  },
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

async function ensureChild(
  conn: Connection,
  parentId: number,
  name: string,
  displayOrder: number,
  now: string,
): Promise<number> {
  const existing = await conn.query(
    `SELECT id FROM canonical_category
     WHERE parentId = ? AND name = ? AND isLocalPrototype = 1
     ORDER BY id ASC LIMIT 1`,
    [parentId, name],
  );
  if (existing[0]?.id) {
    await conn.query(
      `UPDATE canonical_category
       SET status = 'active', displayOrder = ?, updatedAt = ?
       WHERE id = ?`,
      [displayOrder, now, existing[0].id],
    );
    return Number(existing[0].id);
  }

  const result = await conn.query(
    `INSERT INTO canonical_category
      (parentId, name, status, displayOrder, imagePath, discoveryImagePath, audience, isLocalPrototype, createdAt, updatedAt)
     VALUES (?, ?, 'active', ?, NULL, NULL, NULL, 1, ?, ?)`,
    [parentId, name, displayOrder, now, now],
  );
  return Number(result.insertId);
}

async function upsertMapping(
  conn: Connection,
  sourceCategoryId: number,
  canonicalCategoryId: number,
  note: string,
  now: string,
): Promise<boolean> {
  const source = await conn.query(
    `SELECT id FROM category WHERE id = ? LIMIT 1`,
    [sourceCategoryId],
  );
  if (!source.length) return false;

  await conn.query(
    `INSERT INTO source_category_mapping
      (source, sourceCategoryId, canonicalCategoryId, genderSlice, status, reviewStatus, note, createdAt, updatedAt)
     VALUES ('trendyol', ?, ?, 'any', 'active', 'legacy_unreviewed', ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       canonicalCategoryId = VALUES(canonicalCategoryId),
       genderSlice = 'any',
       status = 'active',
       reviewStatus = 'legacy_unreviewed',
       note = VALUES(note),
       updatedAt = VALUES(updatedAt)`,
    [sourceCategoryId, canonicalCategoryId, note, now, now],
  );
  return true;
}

/**
 * CAT-3B Stage-1 — narrowly deactivate over-broad kids mappings owned by this seed.
 * Does NOT bulk-delete unrelated mappings. Idempotent.
 */
export async function reconcileCat3bForbiddenKidsMappings(
  conn: Connection,
  now: string,
): Promise<number> {
  const kidsRoot = await findRoot(conn, 'بچگانه');
  if (!kidsRoot) return 0;

  const descendants: Array<{ id: number }> = await conn.query(
    `
    WITH RECURSIVE kids_tree AS (
      SELECT id FROM canonical_category WHERE id = ?
      UNION ALL
      SELECT c.id FROM canonical_category c
      INNER JOIN kids_tree t ON c.parentId = t.id
    )
    SELECT id FROM kids_tree
    `,
    [kidsRoot.id],
  );
  const kidsCanonicalIds = descendants.map((r) => Number(r.id));
  if (!kidsCanonicalIds.length) return 0;

  const forbidden = [...CAT3B_FORBIDDEN_KIDS_SOURCE_CATEGORY_IDS];
  const placeholders = forbidden.map(() => '?').join(',');
  const canonPlaceholders = kidsCanonicalIds.map(() => '?').join(',');

  const result = await conn.query(
    `UPDATE source_category_mapping
     SET status = 'inactive',
         note = CONCAT(COALESCE(note, ''), ' | CAT-3B: deactivated over-broad kids mapping'),
         updatedAt = ?
     WHERE status = 'active'
       AND sourceCategoryId IN (${placeholders})
       AND canonicalCategoryId IN (${canonPlaceholders})`,
    [now, ...forbidden, ...kidsCanonicalIds],
  );
  return Number(result?.affectedRows ?? result?.affected ?? 0);
}

export async function deepenLocalCanonicalTaxonomy(
  connection?: Connection,
): Promise<{
  familiesCreated: number;
  leavesCreated: number;
  mappingsUpserted: number;
  kidsMappingsDeactivated: number;
  skippedRoots: string[];
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
  let familiesCreated = 0;
  let leavesCreated = 0;
  let mappingsUpserted = 0;
  let kidsMappingsDeactivated = 0;
  const skippedRoots: string[] = [];

  // Ensure discoveryImagePath column exists (migration may not have run yet).
  try {
    await conn.query(
      `SELECT discoveryImagePath FROM canonical_category LIMIT 1`,
    );
  } catch {
    try {
      await conn.query(`
        ALTER TABLE \`canonical_category\`
        ADD COLUMN \`discoveryImagePath\` varchar(255) NULL
        AFTER \`imagePath\`
      `);
    } catch {
      /* column may already exist under race */
    }
  }

  try {
    for (const rootSpec of DEEPEN) {
      const root = await findRoot(conn, rootSpec.name);
      if (!root) {
        skippedRoots.push(rootSpec.name);
        continue;
      }

      for (const family of rootSpec.families) {
        const before = await conn.query(
          `SELECT id FROM canonical_category
           WHERE parentId = ? AND name = ? AND isLocalPrototype = 1 LIMIT 1`,
          [root.id, family.name],
        );
        const familyId = await ensureChild(
          conn,
          root.id,
          family.name,
          family.displayOrder,
          now,
        );
        if (!before.length) familiesCreated += 1;

        if (
          family.sourceCategoryId &&
          !family.leaves.some(
            (l) => l.sourceCategoryId === family.sourceCategoryId,
          )
        ) {
          const ok = await upsertMapping(
            conn,
            family.sourceCategoryId,
            familyId,
            `CAT-2 local: ${rootSpec.name}/${family.name}`,
            now,
          );
          if (ok) mappingsUpserted += 1;
        } else if (
          family.sourceCategoryId &&
          ['زیبایی', 'الکترونیک', 'ورزش'].includes(rootSpec.name)
        ) {
          const ok = await upsertMapping(
            conn,
            family.sourceCategoryId,
            familyId,
            `CAT-2 local: ${rootSpec.name}/${family.name}`,
            now,
          );
          if (ok) mappingsUpserted += 1;
        }

        for (const leaf of family.leaves) {
          const leafBefore = await conn.query(
            `SELECT id FROM canonical_category
             WHERE parentId = ? AND name = ? AND isLocalPrototype = 1 LIMIT 1`,
            [familyId, leaf.name],
          );
          const leafId = await ensureChild(
            conn,
            familyId,
            leaf.name,
            leaf.displayOrder,
            now,
          );
          if (!leafBefore.length) leavesCreated += 1;

          if (leaf.sourceCategoryId) {
            // CAT-3B guard: never upsert forbidden sources under بچگانه
            if (
              rootSpec.name === 'بچگانه' &&
              (
                CAT3B_FORBIDDEN_KIDS_SOURCE_CATEGORY_IDS as readonly number[]
              ).includes(leaf.sourceCategoryId)
            ) {
              continue;
            }
            const ok = await upsertMapping(
              conn,
              leaf.sourceCategoryId,
              leafId,
              `CAT-2 local: ${rootSpec.name}/${family.name}/${leaf.name}`,
              now,
            );
            if (ok) mappingsUpserted += 1;
          }
        }
      }
    }

    kidsMappingsDeactivated = await reconcileCat3bForbiddenKidsMappings(
      conn,
      now,
    );

    return {
      familiesCreated,
      leavesCreated,
      mappingsUpserted,
      kidsMappingsDeactivated,
      skippedRoots,
    };
  } finally {
    if (ownsConnection) await conn.close();
  }
}

if (require.main === module) {
  deepenLocalCanonicalTaxonomy()
    .then((result) => {
      console.log('[CAT-2 seed]', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
