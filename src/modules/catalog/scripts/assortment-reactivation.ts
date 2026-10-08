/**
 * SCOPE-5/6 — controlled reactivation / backfill report for categories that
 * moved to IN_SCOPE. READ-ONLY and idempotent (running it twice yields the
 * same report; nothing is written).
 *
 * Why no writes: once a category is IN_SCOPE,
 *   - discovery picks curated products up immediately (EXISTS predicate),
 *   - Cart / Checkout / PDP read the resolution live (no cached flag on product),
 *   - the existing CatalogRefreshExecutor candidate window includes them on its
 *     next run, bounded by its own candidate cap / budget (existing safe
 *     enqueue mechanism with dedupe).
 * So "reactivation" is an operational report + the normal capped refresh run.
 *
 * Usage (from ragashop-api):
 *   npx ts-node -r tsconfig-paths/register src/modules/catalog/scripts/assortment-reactivation.ts
 *     [--since=<ISO date>]        IN_SCOPE resolutions resolved at/after this time (default: 24h ago)
 *     [--categories=1,2,3]        explicit category ids (overrides --since)
 *     [--stale-days=7]            "needs refresh" threshold
 *     [--cap=500]                 max product ids listed in the report
 */
import { createConnection } from 'typeorm';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const categoriesArg = arg('categories');
  const sinceArg = arg('since');
  const staleDays = Math.max(1, Number(arg('stale-days') || 7));
  const cap = Math.min(Math.max(1, Number(arg('cap') || 500)), 5000);
  const since = sinceArg
    ? new Date(sinceArg)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (Number.isNaN(since.getTime())) throw new Error('Invalid --since');

  const conn = await createConnection();
  try {
    let categoryIds: number[];
    if (categoriesArg) {
      categoryIds = categoriesArg
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
      const rows = await conn.query(
        `SELECT categoryId FROM category_assortment_resolution
          WHERE status = 'IN_SCOPE' AND categoryId IN (?)`,
        [categoryIds.length ? categoryIds : [0]],
      );
      const inSet = new Set(rows.map((r: any) => Number(r.categoryId)));
      const notIn = categoryIds.filter((id) => !inSet.has(id));
      if (notIn.length) {
        console.warn(
          JSON.stringify({
            event: 'reactivation_skipped_not_in_scope',
            categoryIds: notIn,
          }),
        );
      }
      categoryIds = categoryIds.filter((id) => inSet.has(id));
    } else {
      const rows = await conn.query(
        `SELECT categoryId FROM category_assortment_resolution
          WHERE status = 'IN_SCOPE' AND resolvedAt >= ?
          ORDER BY categoryId`,
        [since],
      );
      categoryIds = rows.map((r: any) => Number(r.categoryId));
    }

    const ids = categoryIds.length ? categoryIds : [0];
    const [discovery] = await conn.query(
      `SELECT COUNT(*) AS n FROM product p
        WHERE p.categoryId IN (?) AND p.isDeleted = 0 AND p.status = 'active'
          AND p.isCuratedExternalCatalog = 1`,
      [ids],
    );
    const [refreshWindow] = await conn.query(
      `SELECT COUNT(*) AS n FROM product p
        WHERE p.categoryId IN (?) AND p.supplyType = 'external_source'
          AND p.isCuratedExternalCatalog = 1 AND p.isDeleted = 0
          AND p.source IS NOT NULL AND p.source <> ''
          AND p.sourceId IS NOT NULL AND p.sourceId <> ''
          AND p.sourceAvailability <> 'removed'`,
      [ids],
    );
    const staleBefore = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);
    const needsRefresh = await conn.query(
      `SELECT p.id FROM product p
        WHERE p.categoryId IN (?) AND p.supplyType = 'external_source'
          AND p.isCuratedExternalCatalog = 1 AND p.isDeleted = 0
          AND p.source IS NOT NULL AND p.source <> ''
          AND p.sourceId IS NOT NULL AND p.sourceId <> ''
          AND p.sourceAvailability <> 'removed'
          AND (p.availabilityLastConfirmedAt IS NULL OR p.availabilityLastConfirmedAt < ?)
        ORDER BY p.id LIMIT ${cap + 1}`,
      [ids, staleBefore],
    );
    const [pasteLinkNowEligible] = await conn.query(
      `SELECT COUNT(DISTINCT j.productId) AS n FROM marketplace_import_job j
         JOIN product p ON p.id = j.productId
        WHERE j.requestType = 'customer' AND p.categoryId IN (?)`,
      [ids],
    );

    const report = {
      readOnly: true,
      idempotent: true,
      selection: categoriesArg
        ? 'explicit'
        : `resolvedAt>=${since.toISOString()}`,
      categoriesReactivated: categoryIds.length,
      categoryIds,
      productsReenteringDiscovery: Number(discovery?.n || 0),
      productsReenteringRefreshWindow: Number(refreshWindow?.n || 0),
      productsNeedingRefresh: {
        staleDays,
        count: Math.min(needsRefresh.length, cap),
        truncated: needsRefresh.length > cap,
        sampleIds: needsRefresh
          .slice(0, Math.min(cap, 50))
          .map((r: any) => Number(r.id)),
      },
      pasteLinkReviewRequestsNowPurchasable: Number(
        pasteLinkNowEligible?.n || 0,
      ),
      nextStep:
        'No writes needed. Run the existing catalog refresh executor (dry_run first, then live) — its candidate cap/budget bounds the enqueue.',
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await conn.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
