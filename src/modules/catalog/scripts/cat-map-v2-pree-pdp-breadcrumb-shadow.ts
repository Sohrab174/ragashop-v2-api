/**
 * READ-ONLY CAT-MAP-V2 PRE-E shadow compare:
 * legacy Map(last-write-wins) vs slice-aware PDP breadcrumb resolver
 * against local DB (expected: all real mappings are still `any`).
 *
 * Usage (from ragashop-api):
 *   npx ts-node -r tsconfig-paths/register src/modules/catalog/scripts/cat-map-v2-pree-pdp-breadcrumb-shadow.ts
 *
 * Does not write mappings/products/categories.
 */

import 'dotenv/config';
import { createConnection } from 'typeorm';
import {
  resolveNearestMappedCanonicalId,
  resolveNearestMappedCanonicalIdLegacyLastWriteWins,
} from '../storefront-pdp.mapping-resolve';

type CatRow = { id: number; parentId: number | null; source: string | null };
type MapRow = {
  id: number;
  sourceCategoryId: number;
  canonicalCategoryId: number;
  genderSlice: string;
  reviewStatus: string;
  status: string;
};

function normalizeSource(s: string | null | undefined): string | null {
  const t = String(s || '')
    .trim()
    .toLowerCase();
  return t || null;
}

function collectAncestors(
  startId: number,
  byId: Map<number, CatRow>,
  requiredSource: string | null,
): number[] {
  const ids: number[] = [];
  let current: number | null = startId;
  const seen = new Set<number>();
  while (current != null && current > 1 && ids.length < 12) {
    if (seen.has(current)) break;
    const row = byId.get(current);
    if (!row) break;
    if (ids.length > 0) {
      if (!requiredSource) break;
      if (normalizeSource(row.source) !== requiredSource) break;
    }
    seen.add(current);
    ids.push(current);
    current = row.parentId != null ? Number(row.parentId) : null;
  }
  return ids;
}

async function main() {
  const conn = await createConnection({
    type: (process.env.DATABASE_TYPE as any) || 'mysql',
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 3306),
    username: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD || undefined,
    database: process.env.DATABASE_NAME,
    synchronize: false,
    logging: false,
  });

  try {
    const mappingStats: Array<{
      total: number;
      any_cnt: string;
      female_cnt: string;
      male_cnt: string;
      unisex_cnt: string;
      legacy_cnt: string;
    }> = await conn.query(`
      SELECT
        COUNT(*) AS total,
        SUM(genderSlice = 'any') AS any_cnt,
        SUM(genderSlice = 'female') AS female_cnt,
        SUM(genderSlice = 'male') AS male_cnt,
        SUM(genderSlice = 'unisex') AS unisex_cnt,
        SUM(reviewStatus = 'legacy_unreviewed') AS legacy_cnt
      FROM source_category_mapping
    `);
    console.log('mapping_stats', mappingStats[0]);

    const products: Array<{
      id: number;
      categoryId: number;
      gender: string | null;
      source: string | null;
    }> = await conn.query(`
      SELECT p.id, p.categoryId, p.gender, p.source
      FROM product p
      INNER JOIN category c ON c.id = p.categoryId AND c.status = 'active'
      WHERE p.status = 'active'
        AND p.isDeleted = 0
        AND p.price > 0
        AND p.categoryId != 1
      ORDER BY p.id ASC
      LIMIT 120
    `);

    // Stratified extras: ensure gender mix when available
    const extras: typeof products = await conn.query(`
      (
        SELECT p.id, p.categoryId, p.gender, p.source
        FROM product p
        WHERE p.status='active' AND p.isDeleted=0 AND p.price>0 AND p.categoryId!=1 AND p.gender='female'
        ORDER BY p.id LIMIT 25
      )
      UNION ALL
      (
        SELECT p.id, p.categoryId, p.gender, p.source
        FROM product p
        WHERE p.status='active' AND p.isDeleted=0 AND p.price>0 AND p.categoryId!=1 AND p.gender='male'
        ORDER BY p.id LIMIT 25
      )
      UNION ALL
      (
        SELECT p.id, p.categoryId, p.gender, p.source
        FROM product p
        WHERE p.status='active' AND p.isDeleted=0 AND p.price>0 AND p.categoryId!=1 AND p.gender='unisex'
        ORDER BY p.id LIMIT 15
      )
      UNION ALL
      (
        SELECT p.id, p.categoryId, p.gender, p.source
        FROM product p
        WHERE p.status='active' AND p.isDeleted=0 AND p.price>0 AND p.categoryId!=1 AND p.gender IS NULL
        ORDER BY p.id LIMIT 15
      )
    `);

    const byProduct = new Map<number, (typeof products)[0]>();
    for (const p of [...products, ...extras]) byProduct.set(p.id, p);
    const sample = [...byProduct.values()];

    const categories: CatRow[] = await conn.query(
      `SELECT id, parentId, source FROM category`,
    );
    const catById = new Map(categories.map((c) => [Number(c.id), c]));

    const mappings: MapRow[] = await conn.query(`
      SELECT id, sourceCategoryId, canonicalCategoryId, genderSlice, reviewStatus, status
      FROM source_category_mapping
      WHERE status = 'active'
    `);

    let compared = 0;
    let matched = 0;
    const diffs: Array<{
      productId: number;
      gender: string | null;
      old: number | null;
      neu: number | null;
      ancestors: number[];
    }> = [];

    for (const p of sample) {
      const start = catById.get(Number(p.categoryId));
      const required =
        normalizeSource(p.source) || normalizeSource(start?.source) || null;
      const ancestors = collectAncestors(
        Number(p.categoryId),
        catById,
        required,
      );
      if (!ancestors.length) continue;

      const relevant = mappings.filter((m) =>
        ancestors.includes(Number(m.sourceCategoryId)),
      );
      const oldId = resolveNearestMappedCanonicalIdLegacyLastWriteWins(
        ancestors,
        relevant,
      );
      const newId = resolveNearestMappedCanonicalId(
        ancestors,
        relevant,
        p.gender,
      );

      compared += 1;
      if (oldId === newId) matched += 1;
      else {
        diffs.push({
          productId: p.id,
          gender: p.gender,
          old: oldId,
          neu: newId,
          ancestors,
        });
      }
    }

    const genderBuckets: Record<string, number> = {};
    for (const p of sample) {
      const k = p.gender == null ? 'null' : String(p.gender);
      genderBuckets[k] = (genderBuckets[k] || 0) + 1;
    }

    console.log(
      JSON.stringify(
        {
          sampledProducts: sample.length,
          compared,
          matched,
          differences: diffs.length,
          genderBuckets,
          firstDiffs: diffs.slice(0, 10),
        },
        null,
        2,
      ),
    );

    if (diffs.length) {
      process.exitCode = 2;
    }
  } finally {
    await conn.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
