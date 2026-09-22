/**
 * Read-only timing breakdown for PLP selected-attribute facet path.
 * Does not modify business data.
 */
import { createConnection } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../../../.env') });

async function resolveScope(conn: any, canonicalId: number): Promise<number[]> {
  const t0 = Date.now();
  const mapped = await conn.query(
    `SELECT sourceCategoryId AS id FROM source_category_mapping WHERE canonicalCategoryId = ? AND status = 'active'`,
    [canonicalId],
  );
  const seeds = mapped.map((r: any) => Number(r.id)).filter(Boolean);
  const allCats = await conn.query(
    `SELECT id, parentId FROM category WHERE status = 1`,
  );
  const children = new Map<number, number[]>();
  for (const row of allCats) {
    if (row.parentId == null) continue;
    const p = Number(row.parentId);
    const list = children.get(p) || [];
    list.push(Number(row.id));
    children.set(p, list);
  }
  const scope = new Set(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const id = queue.shift()!;
    for (const child of children.get(id) || []) {
      if (!scope.has(child)) {
        scope.add(child);
        queue.push(child);
      }
    }
  }
  console.log(`scope_ms=${Date.now() - t0} source_count=${scope.size}`);
  return [...scope] as number[];
}

async function timed(label: string, fn: () => Promise<unknown>) {
  const t0 = Date.now();
  const result = await fn();
  console.log(`${label}_ms=${Date.now() - t0}`);
  return result;
}

async function measure(
  conn: any,
  canonicalId: number,
  attrId: number,
  valueId: number,
) {
  console.log(`\n=== cat=${canonicalId} attrs=${attrId}:${valueId} ===`);
  const sourceIds = await resolveScope(conn, canonicalId);
  const ph = sourceIds.map(() => '?').join(',');

  await timed('eligible_temp', async () => {
    await conn.query(`DROP TEMPORARY TABLE IF EXISTS plp_base`);
    await conn.query(
      `CREATE TEMPORARY TABLE plp_base (id INT PRIMARY KEY) AS
       SELECT product.id AS id FROM product product
       INNER JOIN category category ON category.id = product.categoryId AND category.status = 1
       WHERE product.status = 1 AND product.isDeleted = 0 AND product.price > 0
         AND product.categoryId != 1 AND product.categoryId IN (${ph})`,
      sourceIds,
    );
  });
  const [eligCnt] = await conn.query(`SELECT COUNT(*) AS c FROM plp_base`);
  console.log(`eligible_count=${eligCnt[0].c}`);

  await timed('ownership_lookup', async () => {
    await conn.query(
      `SELECT id, attributeId FROM attribute_value WHERE id = ?`,
      [valueId],
    );
  });

  await timed('selected_match_temp', async () => {
    await conn.query(`DROP TEMPORARY TABLE IF EXISTS plp_match_g`);
    await conn.query(
      `CREATE TEMPORARY TABLE plp_match_g (id INT PRIMARY KEY) AS
       SELECT DISTINCT e.id AS id
       FROM plp_base e
       INNER JOIN product_attribute_value pav ON pav.productId = e.id AND pav.isDeleted = 0
       INNER JOIN attribute_value av ON av.id = pav.attributeValueId AND av.attributeId = ?
       WHERE pav.attributeValueId = ?`,
      [attrId, valueId],
    );
  });
  const [matchCnt] = await conn.query(`SELECT COUNT(*) AS c FROM plp_match_g`);
  console.log(`matched_selected_count=${matchCnt[0].c}`);

  // Current-style discovery with EXISTS on full product join (expensive)
  await timed('legacy_discovery_full_exists', async () => {
    await conn.query(
      `SELECT a.id, COUNT(DISTINCT product.id) AS productCount
       FROM product product
       INNER JOIN category category ON category.id = product.categoryId AND category.status = 1
       INNER JOIN product_attribute_value pav_d ON pav_d.productId = product.id AND pav_d.isDeleted = 0
       INNER JOIN attribute_value av_d ON av_d.id = pav_d.attributeValueId
       INNER JOIN attribute a ON a.id = av_d.attributeId
       WHERE product.status = 1 AND product.isDeleted = 0 AND product.price > 0
         AND product.categoryId != 1 AND product.categoryId IN (${ph})
         AND a.name NOT IN (?) AND CHAR_LENGTH(av_d.name) <= 30
         AND EXISTS (
           SELECT 1 FROM product_attribute_value pav_f
           INNER JOIN attribute_value av_f ON av_f.id = pav_f.attributeValueId AND av_f.attributeId = ?
           WHERE pav_f.productId = product.id AND pav_f.isDeleted = 0
             AND pav_f.attributeValueId IN (?)
         )
       GROUP BY a.id
       ORDER BY productCount DESC, a.id ASC
       LIMIT 20`,
      [...sourceIds, 'مبدأ', attrId, valueId],
    );
  });

  // Proposed: discovery from matched set only
  await timed('discovery_from_matched', async () => {
    await conn.query(
      `SELECT av.attributeId AS id, COUNT(DISTINCT e.id) AS productCount
       FROM plp_match_g e
       INNER JOIN product_attribute_value pav ON pav.productId = e.id AND pav.isDeleted = 0
       INNER JOIN attribute_value av ON av.id = pav.attributeValueId
       INNER JOIN attribute a ON a.id = av.attributeId
       WHERE a.name NOT IN (?) AND CHAR_LENGTH(av.name) <= 30
       GROUP BY av.attributeId
       ORDER BY productCount DESC, id ASC
       LIMIT 20`,
      ['مبدأ'],
    );
  });

  // Legacy nonselected values with EXISTS
  await timed('legacy_nonselected_values_exists', async () => {
    await conn.query(
      `SELECT av.attributeId, av.id, COUNT(DISTINCT product.id) c
       FROM product product
       INNER JOIN category category ON category.id = product.categoryId AND category.status = 1
       INNER JOIN product_attribute_value pav ON pav.productId = product.id AND pav.isDeleted = 0
       INNER JOIN attribute_value av ON av.id = pav.attributeValueId
       WHERE product.status = 1 AND product.isDeleted = 0 AND product.price > 0
         AND product.categoryId != 1 AND product.categoryId IN (${ph})
         AND av.attributeId IN (1,4,5,6,11,15,17)
         AND CHAR_LENGTH(av.name) <= 30
         AND EXISTS (
           SELECT 1 FROM product_attribute_value pav_f
           INNER JOIN attribute_value av_f ON av_f.id = pav_f.attributeValueId AND av_f.attributeId = ?
           WHERE pav_f.productId = product.id AND pav_f.isDeleted = 0
             AND pav_f.attributeValueId IN (?)
         )
       GROUP BY av.attributeId, av.id`,
      [...sourceIds, attrId, valueId],
    );
  });

  // Proposed nonselected from matched
  await timed('nonselected_values_from_matched', async () => {
    await conn.query(
      `SELECT pav.attributeValueId AS valueId, COUNT(DISTINCT e.id) AS c
       FROM plp_match_g e
       INNER JOIN product_attribute_value pav ON pav.productId = e.id AND pav.isDeleted = 0
       GROUP BY pav.attributeValueId`,
    );
  });

  // Self-excluding selected facet: all base eligible (N=1)
  await timed('selected_self_excl_values_from_base', async () => {
    await conn.query(
      `SELECT pav.attributeValueId AS valueId, COUNT(DISTINCT e.id) AS c
       FROM plp_base e
       INNER JOIN product_attribute_value pav ON pav.productId = e.id AND pav.isDeleted = 0
       INNER JOIN attribute_value av ON av.id = pav.attributeValueId
       WHERE av.attributeId = ?
       GROUP BY pav.attributeValueId`,
      [attrId],
    );
  });

  // Shared match relation approach total estimate pieces already timed
  await conn.query(`DROP TEMPORARY TABLE IF EXISTS plp_match_g`);
  await conn.query(`DROP TEMPORARY TABLE IF EXISTS plp_base`);
}

async function main() {
  const conn = await createConnection({
    type: (process.env.DATABASE_TYPE as any) || 'mysql',
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '3306', 10),
    username: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    synchronize: false,
    logging: false,
  });
  try {
    // attrs=5:55 from the review; also 5:116 used in prior tests
    await measure(conn, 14, 5, 55);
    await measure(conn, 2, 5, 55);
  } finally {
    await conn.close();
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
