/**
 * READ-ONLY CAT-MAP-V2-B shadow comparison (local development only).
 *
 * Compares, per canonical category:
 *   OLD PLP    = V1 structural scope ∩ CAT-3B audience genders
 *   OLD Search = V1 structural scope only (pre-parity)
 *   NEW        = shared canonical eligibility (PLP + Search)
 * Also simulates reviewed female/male slices IN MEMORY for one mixed source
 * category to exercise the real slice SQL. Nothing is written to the DB.
 *
 * Usage (from ragashop-api):
 *   npx ts-node -r tsconfig-paths/register src/modules/catalog/scripts/cat-map-v2b-shadow-compare.ts [canonicalId ...]
 */
import * as fs from 'fs';
import * as path from 'path';
import { Connection, createConnection, SelectQueryBuilder } from 'typeorm';
import { CategoryStatus } from '../../category/entities/category.entity';
import { applyDiscoveryEligibilityFilters } from '../../product/discovery-eligibility';
import {
  ProductEntity,
  ProductStatus,
} from '../../product/entities/product.entity';
import {
  eligibleProductGendersForAudience,
  isAdultAudienceBrowse,
  resolveCanonicalBrowseAudience,
} from '../canonical-audience-policy';
import { resolveCanonicalCategoryScope } from '../canonical-category-scope.resolver';
import {
  applyCanonicalProductEligibility,
  buildCanonicalEligibilityClauseSql,
  CanonicalEligibilityData,
  CanonicalProductEligibility,
  EligibilityMappingRow,
  resolveCanonicalProductEligibility,
} from '../canonical-product-eligibility';
import { loadCanonicalEligibilityData } from '../canonical-product-eligibility.loader';

const DEFAULT_CANONICAL_IDS = [1, 6, 11, 14, 15, 16, 17, 2, 7, 12];

function baseBuilder(conn: Connection): SelectQueryBuilder<ProductEntity> {
  return conn
    .getRepository(ProductEntity)
    .createQueryBuilder('product')
    .select('product.id', 'id')
    .addSelect('product.gender', 'gender')
    .innerJoin('product.category', 'category', 'category.status = :catStatus', {
      catStatus: CategoryStatus.active,
    })
    .andWhere('product.status = :status', { status: ProductStatus.active })
    .andWhere('product.isDeleted = :isDeleted', { isDeleted: false })
    .andWhere('product.price > 0')
    .andWhere('product.categoryId != 1');
}

type Row = { id: number; gender: string | null };

async function fetchRows(
  qb: SelectQueryBuilder<ProductEntity>,
): Promise<{ rows: Row[]; ms: number; sqlLength: number; params: number }> {
  applyDiscoveryEligibilityFilters(qb, 'product');
  const [sql, params] = qb.getQueryAndParameters();
  const started = Date.now();
  const raw: Array<{ id: number; gender: string | null }> =
    await qb.getRawMany();
  return {
    rows: raw.map((r) => ({ id: Number(r.id), gender: r.gender ?? null })),
    ms: Date.now() - started,
    sqlLength: sql.length,
    params: params.length,
  };
}

async function oldRows(
  conn: Connection,
  data: CanonicalEligibilityData,
  canonicalId: number,
  withAudience: boolean,
) {
  const scope = resolveCanonicalCategoryScope(
    canonicalId,
    data.canonicalRows,
    data.mappings,
    data.sourceTaxonomy,
  );
  if (!scope.sourceCategoryIds.length) {
    return { rows: [] as Row[], ms: 0, sqlLength: 0, params: 0 };
  }
  const qb = baseBuilder(conn).andWhere(
    'product.categoryId IN (:...sourceCategoryIds)',
    { sourceCategoryIds: scope.sourceCategoryIds },
  );
  if (withAudience) {
    const audience = resolveCanonicalBrowseAudience(
      canonicalId,
      data.canonicalRows,
    );
    if (isAdultAudienceBrowse(audience)) {
      qb.andWhere('product.gender IN (:...audienceGenders)', {
        audienceGenders: eligibleProductGendersForAudience(audience),
      });
    }
  }
  return fetchRows(qb);
}

async function newRows(
  conn: Connection,
  eligibility: CanonicalProductEligibility,
) {
  if (!eligibility.sourceCategoryIds.length) {
    return { rows: [] as Row[], ms: 0, sqlLength: 0, params: 0 };
  }
  const qb = baseBuilder(conn);
  applyCanonicalProductEligibility(qb, 'product', eligibility, 'shadow');
  return fetchRows(qb);
}

function genderDistribution(rows: Row[]) {
  const dist: Record<string, number> = {
    female: 0,
    male: 0,
    unisex: 0,
    null: 0,
  };
  for (const r of rows)
    dist[r.gender ?? 'null'] = (dist[r.gender ?? 'null'] || 0) + 1;
  return dist;
}

function diff(oldR: Row[], newR: Row[]) {
  const oldIds = new Set(oldR.map((r) => r.id));
  const newIds = new Set(newR.map((r) => r.id));
  const added = newR.filter((r) => !oldIds.has(r.id));
  const removed = oldR.filter((r) => !newIds.has(r.id));
  return {
    added: added.length,
    removed: removed.length,
    addedGender: genderDistribution(added),
    removedGender: genderDistribution(removed),
    addedSample: added.slice(0, 10).map((r) => r.id),
    removedSample: removed.slice(0, 10).map((r) => r.id),
  };
}

function hasDuplicates(rows: Row[]): boolean {
  return new Set(rows.map((r) => r.id)).size !== rows.length;
}

async function main() {
  const ids = process.argv
    .slice(2)
    .map(Number)
    .filter((n) => n > 0);
  const canonicalIds = ids.length ? ids : DEFAULT_CANONICAL_IDS;

  const conn = await createConnection();
  try {
    const loadStarted = Date.now();
    const data = await loadCanonicalEligibilityData(conn.manager);
    const loadMs = Date.now() - loadStarted;

    const nameById = new Map(data.canonicalRows.map((r) => [r.id, r.name]));
    const categories = [];

    for (const canonicalId of canonicalIds) {
      const resolveStarted = Date.now();
      const eligibility = resolveCanonicalProductEligibility(
        canonicalId,
        data,
        {
          sliceRoutingEnabled: false,
        },
      );
      const eligibilityOn = resolveCanonicalProductEligibility(
        canonicalId,
        data,
        {
          sliceRoutingEnabled: true,
        },
      );
      const resolveMs = Date.now() - resolveStarted;

      const [oldPlp, oldSearch, next, nextOn] = await Promise.all([
        oldRows(conn, data, canonicalId, true),
        oldRows(conn, data, canonicalId, false),
        newRows(conn, eligibility),
        newRows(conn, eligibilityOn),
      ]);

      categories.push({
        canonicalId,
        name: nameById.get(canonicalId),
        audience: eligibility.audience,
        audienceGenders: eligibility.audienceGenders,
        clauses: eligibility.clauses.map((c) => ({
          slice: c.slice,
          sourceCategoryCount: c.sourceCategoryIds.length,
          genders: c.genders,
        })),
        diagnostics: eligibility.diagnostics,
        counts: {
          oldPlp: oldPlp.rows.length,
          oldSearchScope: oldSearch.rows.length,
          new: next.rows.length,
          newFlagOn: nextOn.rows.length,
        },
        plpDiff: diff(oldPlp.rows, next.rows),
        searchDiff: diff(oldSearch.rows, next.rows),
        flagOnVsOff: diff(next.rows, nextOn.rows),
        newGender: genderDistribution(next.rows),
        duplicates: hasDuplicates(next.rows),
        perf: {
          resolveMs,
          oldPlpMs: oldPlp.ms,
          newMs: next.ms,
          oldSqlLength: oldPlp.sqlLength,
          newSqlLength: next.sqlLength,
          oldParams: oldPlp.params,
          newParams: next.params,
        },
      });
    }

    // In-memory slice simulation on the Gömlek source category (never persisted).
    const simulation = await simulateSlices(conn, data);

    const out = {
      at: new Date().toISOString(),
      loadMs,
      loadQueries: 3,
      mappingCount: data.mappings.length,
      categories,
      simulation,
    };
    const outPath = path.join(
      process.env.TEMP || '/tmp',
      'cat-map-v2b-shadow.json',
    );
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        categories.map((c) => ({
          id: c.canonicalId,
          audience: c.audience,
          ...c.counts,
          plpAdded: c.plpDiff.added,
          plpRemoved: c.plpDiff.removed,
          searchRemoved: c.searchDiff.removed,
          searchRemovedGender: c.searchDiff.removedGender,
          dup: c.duplicates,
          ms: `${c.perf.oldPlpMs}/${c.perf.newMs}`,
          sql: `${c.perf.oldSqlLength}/${c.perf.newSqlLength}`,
        })),
        null,
        1,
      ),
    );
    // eslint-disable-next-line no-console
    console.log('SIMULATION', JSON.stringify(simulation, null, 1));
    // eslint-disable-next-line no-console
    console.log('WROTE', outPath);
  } finally {
    await conn.close();
  }
}

async function simulateSlices(
  conn: Connection,
  data: CanonicalEligibilityData,
) {
  const gomlek = await conn.query(
    `SELECT m.id, m.sourceCategoryId, m.canonicalCategoryId
     FROM source_category_mapping m
     JOIN category c ON c.id = m.sourceCategoryId
     WHERE c.sourceName = 'Gömlek' AND m.status = 'active'
     ORDER BY m.id LIMIT 1`,
  );
  if (!gomlek.length) return { skipped: 'no Gömlek mapping' };
  const legacy = gomlek[0];
  const menCanonicalId = Number(legacy.canonicalCategoryId);

  // Women canonical target: any active women's leaf named like the men's leaf.
  const menName = data.canonicalRows.find((r) => r.id === menCanonicalId)?.name;
  const womenCanonical = data.canonicalRows.find(
    (r) =>
      r.id !== menCanonicalId &&
      r.name === menName &&
      resolveCanonicalBrowseAudience(r.id, data.canonicalRows) === 'women',
  );
  const womenCanonicalId = womenCanonical?.id ?? 1;

  const hypothetical: EligibilityMappingRow[] = [
    ...data.mappings.filter((m) => Number(m.id) !== Number(legacy.id)),
    {
      id: -1,
      sourceCategoryId: Number(legacy.sourceCategoryId),
      canonicalCategoryId: menCanonicalId,
      status: 'active',
      source: 'trendyol',
      genderSlice: 'male',
      reviewStatus: 'reviewed_ok',
    },
    {
      id: -2,
      sourceCategoryId: Number(legacy.sourceCategoryId),
      canonicalCategoryId: womenCanonicalId,
      status: 'active',
      source: 'trendyol',
      genderSlice: 'female',
      reviewStatus: 'reviewed_ok',
    },
  ];
  const simData = { ...data, mappings: hypothetical };

  const results: Record<string, unknown> = {
    legacyMappingId: legacy.id,
    sourceCategoryId: legacy.sourceCategoryId,
    menCanonicalId,
    womenCanonicalId,
  };
  for (const [label, canonicalId] of [
    ['men', menCanonicalId],
    ['women', womenCanonicalId],
  ] as Array<[string, number]>) {
    const e = resolveCanonicalProductEligibility(canonicalId, simData, {
      sliceRoutingEnabled: true,
    });
    const r = await newRows(conn, e);
    const clause = buildCanonicalEligibilityClauseSql('product', e, 'sim');
    results[label] = {
      clauses: e.clauses.map((c) => ({
        slice: c.slice,
        n: c.sourceCategoryIds.length,
      })),
      total: r.rows.length,
      gender: genderDistribution(r.rows),
      duplicates: hasDuplicates(r.rows),
      clauseSqlLength: clause?.sql.length ?? 0,
      ms: r.ms,
    };
  }

  // Unisex products from the Gömlek source scope must be eligible in both.
  const menE = resolveCanonicalProductEligibility(menCanonicalId, simData, {
    sliceRoutingEnabled: true,
  });
  const womenE = resolveCanonicalProductEligibility(womenCanonicalId, simData, {
    sliceRoutingEnabled: true,
  });
  const [menR, womenR] = await Promise.all([
    newRows(conn, menE),
    newRows(conn, womenE),
  ]);
  const womenIds = new Set(womenR.rows.map((r) => r.id));
  results.sharedUnisexIds = menR.rows.filter(
    (r) => r.gender === 'unisex' && womenIds.has(r.id),
  ).length;
  return results;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
