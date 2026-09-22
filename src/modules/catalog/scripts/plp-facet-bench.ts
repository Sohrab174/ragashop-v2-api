/**
 * Local read-only PLP facet query plan + index experiment.
 * Does not modify catalog business rows. Index is added/dropped only if
 * --apply-index / --drop-index flags are passed.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/modules/catalog/scripts/plp-facet-bench.ts
 *   npx ts-node -r tsconfig-paths/register src/modules/catalog/scripts/plp-facet-bench.ts --apply-index
 *   npx ts-node -r tsconfig-paths/register src/modules/catalog/scripts/plp-facet-bench.ts --drop-index
 */
import { createConnection } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../../../.env') });

const INDEX_NAME = 'idx_pav_productId_isDeleted_attributeValueId';

async function main() {
  const args = new Set(process.argv.slice(2));
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
    const idxRows = await conn.query(
      `SHOW INDEX FROM product_attribute_value WHERE Key_name = ?`,
      [INDEX_NAME],
    );
    const hasIndex = idxRows.length > 0;
    console.log(`index_present=${hasIndex}`);

    if (args.has('--apply-index') && !hasIndex) {
      console.log('adding composite index...');
      const t0 = Date.now();
      await conn.query(
        `ALTER TABLE product_attribute_value ADD INDEX \`${INDEX_NAME}\` (\`productId\`, \`isDeleted\`, \`attributeValueId\`)`,
      );
      console.log(`index_add_ms=${Date.now() - t0}`);
    }

    if (args.has('--drop-index') && hasIndex) {
      console.log('dropping composite index...');
      await conn.query(
        `ALTER TABLE product_attribute_value DROP INDEX \`${INDEX_NAME}\``,
      );
      console.log('index_dropped=1');
    }

    // Resolve source category ids for canonical category 2 via mappings + descendants
    // Keep this approximate: use mapped source ids for canonical 2 if present.
    const mapped = await conn.query(
      `SELECT sourceCategoryId AS id
       FROM source_category_mapping
       WHERE canonicalCategoryId = 2 AND status = 'active'`,
    );
    let sourceIds: number[] = mapped
      .map((r: any) => Number(r.id))
      .filter(Boolean);
    if (!sourceIds.length) {
      console.log('no mappings for canonical 2; abort');
      return;
    }

    // Include descendants of mapped roots (bounded BFS)
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
    const scope = new Set(sourceIds);
    const queue = [...sourceIds];
    while (queue.length) {
      const id = queue.shift()!;
      for (const child of children.get(id) || []) {
        if (!scope.has(child)) {
          scope.add(child);
          queue.push(child);
        }
      }
    }
    sourceIds = [...scope];
    console.log(`source_category_count=${sourceIds.length}`);

    const placeholders = sourceIds.map(() => '?').join(',');
    const sql = `
      SELECT
        a.id AS attributeId,
        MAX(a.name) AS attributeName,
        MAX(a.type) AS attributeType,
        av.id AS valueId,
        MAX(av.name) AS valueName,
        COUNT(DISTINCT product.id) AS productCount
      FROM product product
      INNER JOIN category category
        ON category.id = product.categoryId AND category.status = 1
      INNER JOIN product_attribute_value pav_v
        ON pav_v.productId = product.id AND pav_v.isDeleted = 0
      INNER JOIN attribute_value av
        ON av.id = pav_v.attributeValueId
      INNER JOIN attribute a
        ON a.id = av.attributeId
      WHERE product.status = 1
        AND product.isDeleted = 0
        AND product.price > 0
        AND product.categoryId != 1
        AND product.categoryId IN (${placeholders})
        AND a.name NOT IN (?)
        AND CHAR_LENGTH(av.name) <= ?
      GROUP BY a.id, av.id
      WITH ROLLUP
    `;
    const params = [...sourceIds, 'مبدأ', 30];

    console.log('--- EXPLAIN ---');
    const explain = await conn.query(`EXPLAIN ${sql}`, params);
    for (const row of explain) {
      console.log(
        JSON.stringify({
          id: row.id,
          select_type: row.select_type,
          table: row.table,
          type: row.type,
          possible_keys: row.possible_keys,
          key: row.key,
          rows: row.rows,
          Extra: row.Extra,
        }),
      );
    }

    for (let i = 1; i <= 2; i += 1) {
      const t0 = Date.now();
      const rows = await conn.query(sql, params);
      console.log(`run${i}_ms=${Date.now() - t0} row_count=${rows.length}`);
    }

    const idxNow = await conn.query(
      `SHOW INDEX FROM product_attribute_value WHERE Key_name = ?`,
      [INDEX_NAME],
    );
    console.log(`index_present_after=${idxNow.length > 0}`);
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
