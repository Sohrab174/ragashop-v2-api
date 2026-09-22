/**
 * Compare discovery-only vs top-20 value aggregation vs full ROLLUP (read-only).
 */
import { createConnection } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../../../.env') });

async function resolveScope(conn: any, canonicalId: number): Promise<number[]> {
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
  return [...scope] as number[];
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
    const baseWhere = `
      FROM product product
      INNER JOIN category category ON category.id = product.categoryId AND category.status = 1
      INNER JOIN product_attribute_value pav ON pav.productId = product.id AND pav.isDeleted = 0
      INNER JOIN attribute_value av ON av.id = pav.attributeValueId
      INNER JOIN attribute a ON a.id = av.attributeId
      WHERE product.status = 1
        AND product.isDeleted = 0
        AND product.price > 0
        AND product.categoryId != 1
        AND product.categoryId IN (${ph})
        AND a.name NOT IN (?)
        AND CHAR_LENGTH(av.name) <= ?
    `;
    const params = [...sourceIds, 'مبدأ', 30];

    const discoverySql = `
      SELECT a.id AS id, COUNT(DISTINCT product.id) AS productCount
      ${baseWhere}
      GROUP BY a.id
      ORDER BY productCount DESC, a.id ASC
      LIMIT 20
    `;

    const t0 = Date.now();
    const top = await conn.query(discoverySql, params);
    console.log(`discovery_ms=${Date.now() - t0} top=${top.length}`);
    const topIds = top.map((r: any) => Number(r.id));
    const topPh = topIds.map(() => '?').join(',');

    const valuesSql = `
      SELECT av.attributeId AS attributeId, av.id AS valueId, COUNT(DISTINCT product.id) AS cnt
      FROM product product
      INNER JOIN category category ON category.id = product.categoryId AND category.status = 1
      INNER JOIN product_attribute_value pav ON pav.productId = product.id AND pav.isDeleted = 0
      INNER JOIN attribute_value av ON av.id = pav.attributeValueId
      WHERE product.status = 1
        AND product.isDeleted = 0
        AND product.price > 0
        AND product.categoryId != 1
        AND product.categoryId IN (${ph})
        AND av.attributeId IN (${topPh})
        AND CHAR_LENGTH(av.name) <= ?
      GROUP BY av.attributeId, av.id
    `;
    const valueParams = [...sourceIds, ...topIds, 30];
    const t1 = Date.now();
    const values = await conn.query(valuesSql, valueParams);
    console.log(`values_top20_ms=${Date.now() - t1} rows=${values.length}`);

    // Eligible product ids materialization approach
    const eligibleSql = `
      SELECT product.id AS id
      FROM product product
      INNER JOIN category category ON category.id = product.categoryId AND category.status = 1
      WHERE product.status = 1
        AND product.isDeleted = 0
        AND product.price > 0
        AND product.categoryId != 1
        AND product.categoryId IN (${ph})
    `;
    const t2 = Date.now();
    await conn.query(`DROP TEMPORARY TABLE IF EXISTS plp_eligible_bench`);
    await conn.query(
      `CREATE TEMPORARY TABLE plp_eligible_bench (id INT PRIMARY KEY) AS ${eligibleSql}`,
      sourceIds,
    );
    console.log(`eligible_temp_ms=${Date.now() - t2}`);

    const fromEligibleDiscovery = `
      SELECT av.attributeId AS id, COUNT(DISTINCT e.id) AS productCount
      FROM plp_eligible_bench e
      INNER JOIN product_attribute_value pav ON pav.productId = e.id AND pav.isDeleted = 0
      INNER JOIN attribute_value av ON av.id = pav.attributeValueId
      INNER JOIN attribute a ON a.id = av.attributeId
      WHERE a.name NOT IN (?) AND CHAR_LENGTH(av.name) <= ?
      GROUP BY av.attributeId
      ORDER BY productCount DESC, id ASC
      LIMIT 20
    `;
    const t3 = Date.now();
    const top2 = await conn.query(fromEligibleDiscovery, ['مبدأ', 30]);
    console.log(`discovery_from_temp_ms=${Date.now() - t3} top=${top2.length}`);
    const topIds2 = top2.map((r: any) => Number(r.id));
    const topPh2 = topIds2.map(() => '?').join(',');

    const valuesFromEligible = `
      SELECT av.attributeId AS attributeId, av.id AS valueId, COUNT(DISTINCT e.id) AS cnt
      FROM plp_eligible_bench e
      INNER JOIN product_attribute_value pav ON pav.productId = e.id AND pav.isDeleted = 0
      INNER JOIN attribute_value av ON av.id = pav.attributeValueId
      WHERE av.attributeId IN (${topPh2})
        AND CHAR_LENGTH(av.name) <= ?
      GROUP BY av.attributeId, av.id
    `;
    const t4 = Date.now();
    const values2 = await conn.query(valuesFromEligible, [...topIds2, 30]);
    console.log(
      `values_from_temp_ms=${Date.now() - t4} rows=${values2.length}`,
    );

    // Single pass from temp with ROLLUP
    const rollupFromTemp = `
      SELECT av.attributeId AS attributeId, av.id AS valueId, COUNT(DISTINCT e.id) AS productCount
      FROM plp_eligible_bench e
      INNER JOIN product_attribute_value pav ON pav.productId = e.id AND pav.isDeleted = 0
      INNER JOIN attribute_value av ON av.id = pav.attributeValueId
      INNER JOIN attribute a ON a.id = av.attributeId
      WHERE a.name NOT IN (?) AND CHAR_LENGTH(av.name) <= ?
      GROUP BY av.attributeId, av.id
      WITH ROLLUP
    `;
    const t5 = Date.now();
    const rollup = await conn.query(rollupFromTemp, ['مبدأ', 30]);
    console.log(`rollup_from_temp_ms=${Date.now() - t5} rows=${rollup.length}`);

    await conn.query(`DROP TEMPORARY TABLE IF EXISTS plp_eligible_bench`);
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
