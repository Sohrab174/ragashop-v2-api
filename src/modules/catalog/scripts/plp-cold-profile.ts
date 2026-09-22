/**
 * Read-only PLP cold-path stage profiler + aggregation variant bake-off.
 * Does not modify business data. Clears nothing in the API process.
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
  const ids = [...scope] as number[];
  console.log(
    `scope_ms=${Date.now() - t0} source_count=${
      ids.length
    } canonical=${canonicalId}`,
  );
  return ids;
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
    const sourceIds = await resolveScope(conn, 2);
    const ph = sourceIds.map(() => '?').join(',');

    // --- eligible temp ---
    let t0 = Date.now();
    await conn.query(`DROP TEMPORARY TABLE IF EXISTS plp_attr_eligible`);
    await conn.query(
      `CREATE TEMPORARY TABLE plp_attr_eligible (id INT PRIMARY KEY) AS
       SELECT product.id AS id
       FROM product product
       INNER JOIN category category
         ON category.id = product.categoryId AND category.status = 1
       WHERE product.status = 1
         AND product.isDeleted = 0
         AND product.price > 0
         AND product.categoryId != 1
         AND product.categoryId IN (${ph})`,
      sourceIds,
    );
    const eligCnt: any = await conn.query(
      `SELECT COUNT(*) AS c FROM plp_attr_eligible`,
    );
    const eligN = Array.isArray(eligCnt)
      ? Number(eligCnt[0]?.c ?? eligCnt[0]?.['COUNT(*)'] ?? 0)
      : 0;
    console.log(`eligible_temp_ms=${Date.now() - t0} eligible=${eligN}`);

    // --- brand facet ---
    t0 = Date.now();
    await conn.query(
      `SELECT product.brandId AS id, COUNT(DISTINCT product.id) AS c
       FROM product product
       INNER JOIN category category
         ON category.id = product.categoryId AND category.status = 1
       INNER JOIN brand brand ON brand.id = product.brandId
       WHERE product.status = 1 AND product.isDeleted = 0 AND product.price > 0
         AND product.categoryId != 1 AND product.categoryId IN (${ph})
         AND product.brandId IS NOT NULL
       GROUP BY product.brandId
       ORDER BY c DESC
       LIMIT 100`,
      sourceIds,
    );
    console.log(`brand_facet_ms=${Date.now() - t0}`);

    // --- price facet ---
    t0 = Date.now();
    await conn.query(
      `SELECT MIN(CASE WHEN product.discountedPrice IS NOT NULL AND product.discountedPrice > 0
                       THEN product.discountedPrice ELSE product.price END) AS minTry,
              MAX(CASE WHEN product.discountedPrice IS NOT NULL AND product.discountedPrice > 0
                       THEN product.discountedPrice ELSE product.price END) AS maxTry
       FROM product product
       INNER JOIN category category
         ON category.id = product.categoryId AND category.status = 1
       WHERE product.status = 1 AND product.isDeleted = 0 AND product.price > 0
         AND product.categoryId != 1 AND product.categoryId IN (${ph})`,
      sourceIds,
    );
    console.log(`price_facet_ms=${Date.now() - t0}`);

    // --- listing page ---
    t0 = Date.now();
    await conn.query(
      `SELECT product.id
       FROM product product
       INNER JOIN category category
         ON category.id = product.categoryId AND category.status = 1
       WHERE product.status = 1 AND product.isDeleted = 0 AND product.price > 0
         AND product.categoryId != 1 AND product.categoryId IN (${ph})
       ORDER BY product.id DESC
       LIMIT 24`,
      sourceIds,
    );
    console.log(`listing_page_ms=${Date.now() - t0}`);

    t0 = Date.now();
    await conn.query(
      `SELECT COUNT(DISTINCT product.id) AS c
       FROM product product
       INNER JOIN category category
         ON category.id = product.categoryId AND category.status = 1
       WHERE product.status = 1 AND product.isDeleted = 0 AND product.price > 0
         AND product.categoryId != 1 AND product.categoryId IN (${ph})`,
      sourceIds,
    );
    console.log(`listing_count_ms=${Date.now() - t0}`);

    // ========== ATTR VARIANTS ==========
    console.log('--- ATTR VARIANTS ---');

    // V0: current ROLLUP (all attrs + attribute join + char_length)
    t0 = Date.now();
    const rollup = await conn.query(
      `SELECT a.id AS attributeId, av.id AS valueId, COUNT(DISTINCT e.id) AS productCount
       FROM plp_attr_eligible e
       INNER JOIN product_attribute_value pav
         ON pav.productId = e.id AND pav.isDeleted = 0
       INNER JOIN attribute_value av ON av.id = pav.attributeValueId
       INNER JOIN attribute a ON a.id = av.attributeId
       WHERE a.name NOT IN (?) AND CHAR_LENGTH(av.name) <= 30
       GROUP BY a.id, av.id
       WITH ROLLUP`,
      ['مبدأ'],
    );
    console.log(`V0_rollup_all_ms=${Date.now() - t0} rows=${rollup.length}`);

    // EXPLAIN V0
    const expl0 = await conn.query(
      `EXPLAIN SELECT a.id AS attributeId, av.id AS valueId, COUNT(DISTINCT e.id) AS productCount
       FROM plp_attr_eligible e
       INNER JOIN product_attribute_value pav
         ON pav.productId = e.id AND pav.isDeleted = 0
       INNER JOIN attribute_value av ON av.id = pav.attributeValueId
       INNER JOIN attribute a ON a.id = av.attributeId
       WHERE a.name NOT IN (?) AND CHAR_LENGTH(av.name) <= 30
       GROUP BY a.id, av.id
       WITH ROLLUP`,
      ['مبدأ'],
    );
    console.log(
      'V0_EXPLAIN=' +
        JSON.stringify(
          expl0.map((r: any) => ({
            table: r.table,
            type: r.type,
            key: r.key,
            rows: r.rows,
            Extra: r.Extra,
          })),
        ),
    );

    // V1: values only, no attribute join, no char_length, no rollup — filter in app later
    t0 = Date.now();
    const v1 = await conn.query(
      `SELECT av.attributeId AS attributeId, av.id AS valueId, COUNT(DISTINCT e.id) AS c
       FROM plp_attr_eligible e
       INNER JOIN product_attribute_value pav
         ON pav.productId = e.id AND pav.isDeleted = 0
       INNER JOIN attribute_value av ON av.id = pav.attributeValueId
       GROUP BY av.attributeId, av.id`,
    );
    console.log(`V1_values_no_attr_ms=${Date.now() - t0} rows=${v1.length}`);

    // V2: discovery DISTINCT only (attr grain), then values for top20
    t0 = Date.now();
    const top = await conn.query(
      `SELECT av.attributeId AS id, COUNT(DISTINCT e.id) AS c
       FROM plp_attr_eligible e
       INNER JOIN product_attribute_value pav
         ON pav.productId = e.id AND pav.isDeleted = 0
       INNER JOIN attribute_value av ON av.id = pav.attributeValueId
       INNER JOIN attribute a ON a.id = av.attributeId
       WHERE a.name NOT IN (?) AND CHAR_LENGTH(av.name) <= 30
       GROUP BY av.attributeId
       ORDER BY c DESC, id ASC
       LIMIT 20`,
      ['مبدأ'],
    );
    const dMs = Date.now() - t0;
    const topIds = top.map((r: any) => Number(r.id));
    const topPh = topIds.map(() => '?').join(',');
    t0 = Date.now();
    const vals = await conn.query(
      `SELECT av.attributeId AS attributeId, av.id AS valueId, COUNT(DISTINCT e.id) AS c
       FROM plp_attr_eligible e
       INNER JOIN product_attribute_value pav
         ON pav.productId = e.id AND pav.isDeleted = 0
       INNER JOIN attribute_value av ON av.id = pav.attributeValueId
       WHERE av.attributeId IN (${topPh}) AND CHAR_LENGTH(av.name) <= 30
       GROUP BY av.attributeId, av.id`,
      topIds,
    );
    const vMs = Date.now() - t0;
    console.log(
      `V2_discovery_ms=${dMs} V2_values_top20_ms=${vMs} V2_total_ms=${
        dMs + vMs
      } top=${topIds.length} val_rows=${vals.length}`,
    );

    // V3: lean discovery (no attr join / char_length), filter excluded after; values top20 with char_length
    t0 = Date.now();
    const leanTop = await conn.query(
      `SELECT av.attributeId AS id, COUNT(DISTINCT e.id) AS c
       FROM plp_attr_eligible e
       INNER JOIN product_attribute_value pav
         ON pav.productId = e.id AND pav.isDeleted = 0
       INNER JOIN attribute_value av ON av.id = pav.attributeValueId
       GROUP BY av.attributeId
       ORDER BY c DESC, id ASC
       LIMIT 40`,
    );
    const leanD = Date.now() - t0;
    const meta = await conn.query(
      `SELECT id, name, type FROM attribute WHERE id IN (${leanTop
        .map(() => '?')
        .join(',')})`,
      leanTop.map((r: any) => Number(r.id)),
    );
    const metaById = new Map<
      number,
      { id: number; name: string; type: string }
    >(
      meta.map((r: any) => [
        Number(r.id),
        {
          id: Number(r.id),
          name: String(r.name || ''),
          type: String(r.type || ''),
        },
      ]),
    );
    const filteredTop = leanTop
      .map((r: any) => Number(r.id))
      .filter((id: number) => {
        const m = metaById.get(id);
        return m && String(m.name || '').trim() !== 'مبدأ';
      })
      .slice(0, 20);
    const fPh = filteredTop.map(() => '?').join(',');
    t0 = Date.now();
    const leanVals = await conn.query(
      `SELECT av.attributeId AS attributeId, av.id AS valueId, COUNT(DISTINCT e.id) AS c
       FROM plp_attr_eligible e
       INNER JOIN product_attribute_value pav
         ON pav.productId = e.id AND pav.isDeleted = 0
       INNER JOIN attribute_value av ON av.id = pav.attributeValueId
       WHERE av.attributeId IN (${fPh}) AND CHAR_LENGTH(av.name) <= 30
       GROUP BY av.attributeId, av.id`,
      filteredTop,
    );
    const leanV = Date.now() - t0;
    console.log(
      `V3_lean_discovery_ms=${leanD} V3_values_ms=${leanV} V3_total_ms=${
        leanD + leanV
      } val_rows=${leanVals.length}`,
    );

    // V4: covering-index style — group by attributeValueId only from pav, map attributeId later
    t0 = Date.now();
    const byVal = await conn.query(
      `SELECT pav.attributeValueId AS valueId, COUNT(DISTINCT e.id) AS c
       FROM plp_attr_eligible e
       INNER JOIN product_attribute_value pav
         ON pav.productId = e.id AND pav.isDeleted = 0
       GROUP BY pav.attributeValueId`,
    );
    console.log(
      `V4_pav_valueId_only_ms=${Date.now() - t0} rows=${byVal.length}`,
    );

    // V5: pre-filter allowed attribute ids, then values GROUP BY without joining attribute during agg
    const allowed = await conn.query(
      `SELECT id FROM attribute WHERE name NOT IN (?)`,
      ['مبدأ'],
    );
    const allowedIds = allowed.map((r: any) => Number(r.id));
    const aPh = allowedIds.map(() => '?').join(',');
    t0 = Date.now();
    const v5 = await conn.query(
      `SELECT av.attributeId AS attributeId, av.id AS valueId, COUNT(DISTINCT e.id) AS c
       FROM plp_attr_eligible e
       INNER JOIN product_attribute_value pav
         ON pav.productId = e.id AND pav.isDeleted = 0
       INNER JOIN attribute_value av ON av.id = pav.attributeValueId
       WHERE av.attributeId IN (${aPh}) AND CHAR_LENGTH(av.name) <= 30
       GROUP BY av.attributeId, av.id`,
      allowedIds,
    );
    console.log(`V5_allowed_attr_ids_ms=${Date.now() - t0} rows=${v5.length}`);

    // V6: two-stage in ONE connection — discovery with allowed ids only (no char_length), then top20 values
    t0 = Date.now();
    const top6 = await conn.query(
      `SELECT av.attributeId AS id, COUNT(DISTINCT e.id) AS c
       FROM plp_attr_eligible e
       INNER JOIN product_attribute_value pav
         ON pav.productId = e.id AND pav.isDeleted = 0
       INNER JOIN attribute_value av ON av.id = pav.attributeValueId
       WHERE av.attributeId IN (${aPh})
       GROUP BY av.attributeId
       ORDER BY c DESC, id ASC
       LIMIT 20`,
      allowedIds,
    );
    const d6 = Date.now() - t0;
    const ids6 = top6.map((r: any) => Number(r.id));
    const p6 = ids6.map(() => '?').join(',');
    t0 = Date.now();
    const vals6 = await conn.query(
      `SELECT av.attributeId AS attributeId, av.id AS valueId, COUNT(DISTINCT e.id) AS c
       FROM plp_attr_eligible e
       INNER JOIN product_attribute_value pav
         ON pav.productId = e.id AND pav.isDeleted = 0
       INNER JOIN attribute_value av ON av.id = pav.attributeValueId
       WHERE av.attributeId IN (${p6}) AND CHAR_LENGTH(av.name) <= 30
       GROUP BY av.attributeId, av.id`,
      ids6,
    );
    const v6 = Date.now() - t0;
    console.log(
      `V6_disc_ms=${d6} V6_val_ms=${v6} V6_total_ms=${d6 + v6} val_rows=${
        vals6.length
      }`,
    );

    // V7: INSERT DISTINCT pairs into temp (productId, attributeId, valueId) then cheap GROUP BY
    t0 = Date.now();
    await conn.query(`DROP TEMPORARY TABLE IF EXISTS plp_pav_pairs`);
    await conn.query(
      `CREATE TEMPORARY TABLE plp_pav_pairs (
         productId INT NOT NULL,
         attributeId INT NOT NULL,
         valueId INT NOT NULL,
         PRIMARY KEY (productId, valueId),
         KEY idx_attr_val (attributeId, valueId)
       )`,
    );
    await conn.query(
      `INSERT IGNORE INTO plp_pav_pairs (productId, attributeId, valueId)
       SELECT e.id, av.attributeId, av.id
       FROM plp_attr_eligible e
       INNER JOIN product_attribute_value pav
         ON pav.productId = e.id AND pav.isDeleted = 0
       INNER JOIN attribute_value av ON av.id = pav.attributeValueId
       WHERE av.attributeId IN (${aPh}) AND CHAR_LENGTH(av.name) <= 30`,
      allowedIds,
    );
    const buildMs = Date.now() - t0;
    t0 = Date.now();
    const pairVals = await conn.query(
      `SELECT attributeId, valueId, COUNT(*) AS c
       FROM plp_pav_pairs
       GROUP BY attributeId, valueId`,
    );
    const pairAttr = await conn.query(
      `SELECT attributeId, COUNT(DISTINCT productId) AS c
       FROM plp_pav_pairs
       GROUP BY attributeId
       ORDER BY c DESC
       LIMIT 20`,
    );
    console.log(
      `V7_pairs_build_ms=${buildMs} V7_agg_ms=${Date.now() - t0} val_rows=${
        pairVals.length
      } top=${pairAttr.length}`,
    );

    // V8: SQL_BIG_RESULT / session heap
    await conn.query(`SET SESSION tmp_table_size = 268435456`);
    await conn.query(`SET SESSION max_heap_table_size = 268435456`);
    t0 = Date.now();
    const v8 = await conn.query(
      `SELECT SQL_BIG_RESULT av.attributeId AS attributeId, av.id AS valueId, COUNT(DISTINCT e.id) AS c
       FROM plp_attr_eligible e
       INNER JOIN product_attribute_value pav
         ON pav.productId = e.id AND pav.isDeleted = 0
       INNER JOIN attribute_value av ON av.id = pav.attributeValueId
       WHERE av.attributeId IN (${aPh}) AND CHAR_LENGTH(av.name) <= 30
       GROUP BY av.attributeId, av.id`,
      allowedIds,
    );
    console.log(`V8_sql_big_result_ms=${Date.now() - t0} rows=${v8.length}`);

    await conn.query(`DROP TEMPORARY TABLE IF EXISTS plp_attr_eligible`);
    await conn.query(`DROP TEMPORARY TABLE IF EXISTS plp_pav_pairs`);
  } finally {
    await conn.close();
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
