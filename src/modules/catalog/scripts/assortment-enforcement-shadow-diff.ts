/**
 * SCOPE-5/6 — READ-ONLY shadow diff before enabling assortment enforcement.
 *
 * Compares customer discovery with ASSORTMENT_DISCOVERY_ENFORCEMENT off vs on
 * using the REAL shared builders (applyDiscoveryEligibilityFilters +
 * resolveCanonicalProductEligibility). Nothing is written to the DB.
 *
 * Reports:
 *   - global discovery (Search / home / suggestions share this set)
 *   - per canonical category PLP / nav counts (before / after / delta)
 *   - ancestor leakage: source categories removed from mapping expansion
 *   - sample Search term deltas
 *   - commerce: live products losing purchase, cart lines affected
 *   - crawler: refresh candidates stopped
 *
 * Usage (from ragashop-api):
 *   npx ts-node -r tsconfig-paths/register src/modules/catalog/scripts/assortment-enforcement-shadow-diff.ts [--out=<file>]
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
  applyCanonicalProductEligibility,
  CanonicalEligibilityData,
  resolveCanonicalProductEligibility,
} from '../canonical-product-eligibility';
import { loadCanonicalEligibilityData } from '../canonical-product-eligibility.loader';
import { ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV } from '../assortment-policy/assortment-enforcement';

const SEARCH_TERMS = [
  'مبل',
  'کاناپه',
  'میز',
  'لباس',
  'کفش',
  'عطر',
  'koltuk',
  'masa',
];

function setDiscoveryFlag(on: boolean) {
  if (on) process.env[ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV] = '1';
  else delete process.env[ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV];
}

/** Mirrors the PLP/Search base (cat-map-v2b shadow-compare). */
function baseBuilder(conn: Connection): SelectQueryBuilder<ProductEntity> {
  return conn
    .getRepository(ProductEntity)
    .createQueryBuilder('product')
    .innerJoin('product.category', 'category', 'category.status = :catStatus', {
      catStatus: CategoryStatus.active,
    })
    .andWhere('product.status = :status', { status: ProductStatus.active })
    .andWhere('product.isDeleted = :isDeleted', { isDeleted: false })
    .andWhere('product.price > 0')
    .andWhere('product.categoryId != 1');
}

async function countDistinct(
  qb: SelectQueryBuilder<ProductEntity>,
): Promise<{ n: number; ms: number }> {
  applyDiscoveryEligibilityFilters(qb, 'product');
  const started = Date.now();
  const row = await qb.select('COUNT(DISTINCT product.id)', 'n').getRawOne();
  return { n: Number(row?.n || 0), ms: Date.now() - started };
}

async function canonicalCount(
  conn: Connection,
  data: CanonicalEligibilityData,
  canonicalId: number,
  enforcement: boolean,
) {
  setDiscoveryFlag(enforcement);
  const eligibility = resolveCanonicalProductEligibility(canonicalId, data, {
    sliceRoutingEnabled: false,
  });
  if (!eligibility.sourceCategoryIds.length) {
    return { n: 0, ms: 0, sourceCategoryIds: [] as number[] };
  }
  const qb = baseBuilder(conn);
  applyCanonicalProductEligibility(qb, 'product', eligibility, 'shadow');
  const r = await countDistinct(qb);
  return { ...r, sourceCategoryIds: eligibility.sourceCategoryIds };
}

async function main() {
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const outFile =
    outArg?.slice('--out='.length) ||
    path.join(
      process.env.TEMP || '/tmp',
      'rs_pilot',
      'scope56-shadow-diff.json',
    );
  const originalFlag = process.env[ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV];

  const conn = await createConnection();
  try {
    // --- policy snapshot facts
    const [state] = await conn.query(
      `SELECT policyVersion FROM assortment_policy_state WHERE id = 1`,
    );
    const statusRows: Array<{ categoryId: number; status: string }> =
      await conn.query(
        `SELECT categoryId, status FROM category_assortment_resolution`,
      );
    const statusMap = new Map<number, string>(
      statusRows.map((r) => [Number(r.categoryId), String(r.status)]),
    );

    // --- global discovery (Search / home / suggestions)
    setDiscoveryFlag(false);
    const globalBefore = await countDistinct(baseBuilder(conn));
    setDiscoveryFlag(true);
    const globalAfter = await countDistinct(baseBuilder(conn));
    setDiscoveryFlag(false);
    const byStatusRaw = await (() => {
      const qb = baseBuilder(conn).leftJoin(
        'category_assortment_resolution',
        'r',
        'r.categoryId = product.categoryId',
      );
      applyDiscoveryEligibilityFilters(qb, 'product');
      return qb
        .select("COALESCE(r.status, 'MISSING')", 'status')
        .addSelect('COUNT(DISTINCT product.id)', 'n')
        .groupBy("COALESCE(r.status, 'MISSING')")
        .getRawMany();
    })();
    const discoverableByStatus: Record<string, number> = {};
    for (const r of byStatusRaw) discoverableByStatus[r.status] = Number(r.n);

    // --- per canonical (PLP + category-scoped Search + nav counts)
    setDiscoveryFlag(false);
    const dataOff = await loadCanonicalEligibilityData(conn.manager);
    setDiscoveryFlag(true);
    const dataOn = await loadCanonicalEligibilityData(conn.manager);
    const directlyMapped = new Set(
      dataOff.mappings
        .filter((m) => m.status === 'active')
        .map((m) => Number(m.sourceCategoryId)),
    );
    const canonicalIds = dataOff.canonicalRows
      .filter((c) => c.status === 'active')
      .map((c) => Number(c.id));

    const perCanonical: any[] = [];
    let maxMsBefore = 0;
    let maxMsAfter = 0;
    for (const id of canonicalIds) {
      const before = await canonicalCount(conn, dataOff, id, false);
      const after = await canonicalCount(conn, dataOn, id, true);
      maxMsBefore = Math.max(maxMsBefore, before.ms);
      maxMsAfter = Math.max(maxMsAfter, after.ms);
      const afterSet = new Set(after.sourceCategoryIds);
      const removed = before.sourceCategoryIds.filter((c) => !afterSet.has(c));
      const removedViaExpansion = removed.filter((c) => !directlyMapped.has(c));
      const row = dataOff.canonicalRows.find((c) => Number(c.id) === id);
      perCanonical.push({
        canonicalId: id,
        name: row?.name,
        isRoot: row?.parentId == null,
        before: before.n,
        after: after.n,
        delta: after.n - before.n,
        sourceScopeBefore: before.sourceCategoryIds.length,
        sourceScopeAfter: after.sourceCategoryIds.length,
        removedSourceCategories: removed.length,
        ancestorLeakageRemoved: removedViaExpansion.length,
        removedByStatus: removed.reduce<Record<string, number>>((acc, c) => {
          const s = statusMap.get(c) || 'MISSING';
          acc[s] = (acc[s] || 0) + 1;
          return acc;
        }, {}),
      });
    }
    setDiscoveryFlag(false);

    // --- ancestor leakage, global (distinct source categories)
    const leakageCats = new Set<number>();
    for (const id of canonicalIds) {
      setDiscoveryFlag(false);
      const b = resolveCanonicalProductEligibility(id, dataOff, {
        sliceRoutingEnabled: false,
      });
      setDiscoveryFlag(true);
      const a = resolveCanonicalProductEligibility(id, dataOn, {
        sliceRoutingEnabled: false,
      });
      const aSet = new Set(a.sourceCategoryIds);
      for (const c of b.sourceCategoryIds) {
        if (!aSet.has(c) && !directlyMapped.has(c)) leakageCats.add(c);
      }
    }
    setDiscoveryFlag(false);
    let leakageProducts = 0;
    if (leakageCats.size) {
      const qb = baseBuilder(conn).andWhere('product.categoryId IN (:...ids)', {
        ids: [...leakageCats],
      });
      leakageProducts = (await countDistinct(qb)).n;
    }

    // --- sample Search terms (unscoped text match on name)
    const searchTerms: any[] = [];
    for (const term of SEARCH_TERMS) {
      const counts: number[] = [];
      for (const on of [false, true]) {
        setDiscoveryFlag(on);
        const qb = baseBuilder(conn).andWhere('product.name LIKE :q', {
          q: `%${term}%`,
        });
        counts.push((await countDistinct(qb)).n);
      }
      searchTerms.push({
        term,
        before: counts[0],
        after: counts[1],
        delta: counts[1] - counts[0],
      });
    }
    setDiscoveryFlag(false);

    // --- commerce + crawler consequences
    const [losingPurchase] = await conn.query(
      `SELECT COUNT(*) AS n FROM product p
         LEFT JOIN category_assortment_resolution r ON r.categoryId = p.categoryId
        WHERE p.isDeleted = 0 AND (r.status IS NULL OR r.status <> 'IN_SCOPE')`,
    );
    const [cartLines] = await conn.query(
      `SELECT COUNT(*) AS lineCount, COUNT(DISTINCT ci.cartId) AS carts FROM cart_item ci
         JOIN product p ON p.id = ci.productId
         LEFT JOIN category_assortment_resolution r ON r.categoryId = p.categoryId
        WHERE r.status IS NULL OR r.status <> 'IN_SCOPE'`,
    );
    const refreshStopped = await conn.query(
      `SELECT COALESCE(r.status, 'MISSING') AS status, COUNT(*) AS n FROM product p
         LEFT JOIN category_assortment_resolution r ON r.categoryId = p.categoryId
        WHERE p.supplyType = 'external_source' AND p.isCuratedExternalCatalog = 1
          AND p.isDeleted = 0 AND p.source IS NOT NULL AND p.source <> ''
          AND p.sourceId IS NOT NULL AND p.sourceId <> ''
          AND p.sourceAvailability <> 'removed'
          AND (r.status IS NULL OR r.status <> 'IN_SCOPE')
        GROUP BY COALESCE(r.status, 'MISSING')`,
    );
    const [orderItemsNonIn] = await conn.query(
      `SELECT COUNT(*) AS n FROM order_item oi
         JOIN product p ON p.id = oi.productId
         LEFT JOIN category_assortment_resolution r ON r.categoryId = p.categoryId
        WHERE r.status IS NULL OR r.status <> 'IN_SCOPE'`,
    );

    const totalBefore = perCanonical.reduce((s, r) => s + r.before, 0);
    const report = {
      readOnly: true,
      policyVersion: Number(state?.policyVersion || 0),
      resolutionCount: statusMap.size,
      globalDiscovery: {
        before: globalBefore.n,
        after: globalAfter.n,
        delta: globalAfter.n - globalBefore.n,
        beforeMs: globalBefore.ms,
        afterMs: globalAfter.ms,
        discoverableByStatus,
        note: 'Search, suggestions, home/cover share applyDiscoveryEligibilityFilters',
      },
      canonical: {
        categories: perCanonical.length,
        changedCategories: perCanonical.filter((r) => r.delta !== 0).length,
        emptiedCategories: perCanonical.filter(
          (r) => r.before > 0 && r.after === 0,
        ).length,
        sumBefore: totalBefore,
        sumAfter: perCanonical.reduce((s, r) => s + r.after, 0),
        maxQueryMsBefore: maxMsBefore,
        maxQueryMsAfter: maxMsAfter,
        roots: perCanonical.filter((r) => r.isRoot),
        topDeltas: [...perCanonical]
          .sort((a, b) => a.delta - b.delta)
          .slice(0, 15),
      },
      ancestorLeakage: {
        sourceCategoriesRemovedFromExpansion: leakageCats.size,
        discoverableProductsInThoseCategories: leakageProducts,
      },
      searchTerms,
      commerce: {
        liveProductsLosingPurchase: Number(losingPurchase?.n || 0),
        cartLinesAffected: Number(cartLines?.lineCount || 0),
        cartsAffected: Number(cartLines?.carts || 0),
        historicalOrderItemsNonIn: Number(orderItemsNonIn?.n || 0),
      },
      crawler: {
        refreshCandidatesStopped: refreshStopped.reduce(
          (acc: Record<string, number>, r: any) => ({
            ...acc,
            [r.status]: Number(r.n),
          }),
          {},
        ),
      },
      perCanonical,
    };

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
    const { perCanonical: _omit, ...summary } = report;
    void _omit;
    console.log(
      JSON.stringify(
        {
          ...summary,
          canonical: {
            ...summary.canonical,
            roots: summary.canonical.roots.map((r: any) => ({
              id: r.canonicalId,
              name: r.name,
              before: r.before,
              after: r.after,
              delta: r.delta,
            })),
            topDeltas: summary.canonical.topDeltas.map((r: any) => ({
              id: r.canonicalId,
              name: r.name,
              before: r.before,
              after: r.after,
              delta: r.delta,
              leak: r.ancestorLeakageRemoved,
            })),
          },
          outFile,
        },
        null,
        2,
      ),
    );
  } finally {
    if (originalFlag === undefined)
      delete process.env[ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV];
    else process.env[ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV] = originalFlag;
    await conn.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
