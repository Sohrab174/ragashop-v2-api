/**
 * Read-only verification helpers for the pet/shoe parent fix.
 * Used against an isolated database copy — never mutates.
 *
 * Run:
 *   DATABASE_NAME=ragashop_local_pet_fix_iso npx ts-node -r tsconfig-paths/register \
 *     src/database/scripts/verify-pet-shoe-parent-fix.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as mysql from 'mysql2/promise';

function loadEnv(): Record<string, string> {
  const envPath = path.join(__dirname, '../../../.env');
  const env: Record<string, string> = { ...process.env } as Record<
    string,
    string
  >;
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      let v = m[2];
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (env[m[1]] == null) env[m[1]] = v;
    }
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const database = env.DATABASE_NAME || 'ragashop_local';
  const conn = await mysql.createConnection({
    host: env.DATABASE_HOST || '127.0.0.1',
    port: Number(env.DATABASE_PORT || 3306),
    user: env.DATABASE_USERNAME || 'root',
    password: env.DATABASE_PASSWORD || '',
    database,
    charset: 'utf8mb4',
  });
  const q = async (sql: string, params?: unknown[]) =>
    (await conn.query(sql, params))[0] as any[];

  const shoes = await q(
    `SELECT id, parentId, sourceId, sourceName, hierarchy
     FROM category
     WHERE source='trendyol' AND sourceId IN ('1108','104543','101421','113')
     ORDER BY sourceId`,
  );
  const root = await q(
    `SELECT id FROM category WHERE source='trendyol' AND sourceId='114' AND sourceName='Ayakkabı'`,
  );
  const collars = await q(
    `SELECT id FROM category WHERE source='trendyol' AND sourceId='1352'`,
  );
  const underCollars = await q(
    `SELECT COUNT(*) AS n FROM category shoe
     JOIN category collars ON collars.id = shoe.parentId
     WHERE collars.sourceId='1352' AND shoe.hierarchy LIKE 'Ayakkabı/%'`,
  );
  const ballerina = await q(
    `SELECT COUNT(*) AS n FROM category flat
     JOIN category babet ON babet.id = flat.parentId
     WHERE flat.sourceId='410' AND babet.sourceId='113'`,
  );
  const collarKids = await q(
    `SELECT id, sourceId, sourceName, hierarchy FROM category
     WHERE parentId = (SELECT id FROM category WHERE sourceId='1352' LIMIT 1)`,
  );
  const productIdsStable = await q(
    `SELECT COUNT(*) AS n FROM product
     WHERE categoryId IN (
       SELECT id FROM category WHERE sourceId IN ('1108','104543','101421','113','410')
     )`,
  );
  const mapping = await q(
    `SELECT canonicalCategoryId, sourceCategoryId, note
     FROM source_category_mapping
     WHERE sourceCategoryId = (SELECT id FROM category WHERE sourceId='1352' LIMIT 1)`,
  );

  const report = {
    database,
    shoeParents: shoes,
    shoesRootId: root[0]?.id ?? null,
    collarsId: collars[0]?.id ?? null,
    shoesUnderDogCollars: Number(underCollars[0].n),
    ballerinaUnderBabet: Number(ballerina[0].n),
    collarChildren: collarKids,
    productsOnAffectedCategories: Number(productIdsStable[0].n),
    dogCollarsMapping: mapping,
    ok:
      Number(underCollars[0].n) === 0 &&
      Number(ballerina[0].n) === 1 &&
      shoes.every((s) => Number(s.parentId) === Number(root[0]?.id)),
  };
  console.log(JSON.stringify(report, null, 2));
  await conn.end();
  if (!report.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
