/**
 * READ-ONLY CAT-MAP-V2-A classification audit for existing mappings.
 *
 * Usage (from ragashop-api):
 *   npx ts-node -r tsconfig-paths/register src/modules/catalog/scripts/cat-map-v2a-classify-mappings.ts
 *
 * Does NOT write to the database.
 */
import { createConnection } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import {
  accumulateProductGender,
  buildCanonicalPath,
  classifyLegacyMappingRow,
  emptyDistribution,
  expandMappingSourceScope,
  resolveCanonicalRoot,
} from '../cat-map-v2a-classification';

async function main() {
  const conn = await createConnection();
  try {
    const mappings: Array<{
      id: number;
      source: string;
      sourceCategoryId: number;
      canonicalCategoryId: number;
      status: string;
      genderSlice: string;
      reviewStatus: string;
    }> = await conn.query(
      `SELECT id, source, sourceCategoryId, canonicalCategoryId, status,
              genderSlice, reviewStatus
       FROM source_category_mapping
       ORDER BY id ASC`,
    );

    const canonicals: Array<{
      id: number;
      parentId: number | null;
      name: string;
      audience: string | null;
      status: string;
    }> = await conn.query(
      `SELECT id, parentId, name, audience, status FROM canonical_category`,
    );

    const taxonomy: Array<{
      id: number;
      parentId: number | null;
      source: string | null;
      status: string;
      name: string;
      sourceName: string | null;
      sourceId: string | null;
    }> = await conn.query(
      `SELECT id, parentId, source, status, name, sourceName, sourceId FROM category`,
    );
    const categoryById = new Map(taxonomy.map((c) => [Number(c.id), c]));

    const products: Array<{ categoryId: number; gender: string | null }> =
      await conn.query(
        `SELECT categoryId, gender FROM product WHERE isDeleted = 0`,
      );

    const gendersByCategory = new Map<number, Array<string | null>>();
    for (const p of products) {
      const cid = Number(p.categoryId);
      const list = gendersByCategory.get(cid) || [];
      list.push(p.gender);
      gendersByCategory.set(cid, list);
    }

    const rows = [];
    for (const m of mappings) {
      const sourceCat = categoryById.get(Number(m.sourceCategoryId));
      const scopeIds = expandMappingSourceScope(
        { sourceCategoryId: m.sourceCategoryId, source: m.source },
        taxonomy,
      );
      const dist = emptyDistribution();
      for (const sid of scopeIds) {
        for (const g of gendersByCategory.get(sid) || []) {
          accumulateProductGender(dist, g);
        }
      }

      const root = resolveCanonicalRoot(m.canonicalCategoryId, canonicals);
      const pathNames = buildCanonicalPath(m.canonicalCategoryId, canonicals);
      const classified = classifyLegacyMappingRow({
        mappingId: m.id,
        sourceCategoryId: m.sourceCategoryId,
        source: m.source,
        sourceName: sourceCat?.sourceName ?? null,
        sourceFaName: sourceCat?.name ?? null,
        providerSourceId: sourceCat?.sourceId ?? null,
        canonicalCategoryId: m.canonicalCategoryId,
        canonicalName:
          canonicals.find((c) => Number(c.id) === Number(m.canonicalCategoryId))
            ?.name ?? null,
        canonicalPath: pathNames,
        rootAudience: root.rootAudience,
        rootName: root.rootName,
        distribution: dist,
      });

      rows.push({
        ...classified,
        genderSlice: m.genderSlice,
        reviewStatus: m.reviewStatus,
        mappingStatus: m.status,
        scopeSourceCategoryCount: scopeIds.length,
      });
    }

    const summary = {
      totalMappings: rows.length,
      byClassification: rows.reduce((acc, r) => {
        acc[r.classification] = (acc[r.classification] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      mixedHighlight: rows
        .filter((r) => r.classification === 'MIXED_REVIEW_REQUIRED')
        .sort((a, b) => b.distribution.total - a.distribution.total)
        .slice(0, 20)
        .map((r) => ({
          mappingId: r.mappingId,
          sourceName: r.sourceName,
          sourceFaName: r.sourceFaName,
          path: r.canonicalPath.join(' / '),
          root: r.rootName,
          total: r.distribution.total,
          female: r.distribution.female,
          male: r.distribution.male,
          unisex: r.distribution.unisex,
          unknown: r.distribution.unknown,
        })),
    };

    const out = { summary, rows };
    const outPath = path.join(
      process.env.TEMP || '/tmp',
      'cat-map-v2a-classification.json',
    );
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
    // eslint-disable-next-line no-console
    console.log('WROTE', outPath);
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
