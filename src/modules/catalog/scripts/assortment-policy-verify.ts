/**
 * SCOPE-2 — read-only assortment policy verification / shadow report.
 *
 * Usage:
 *   npm run catalog:assortment-policy:verify
 *
 * SELECT only. Never mutates.
 */
import { createConnection } from 'typeorm';
import { findDuplicateActiveSelectors } from '../assortment-policy/assortment-policy.validate';

const FORENSIC = {
  categories: { IN_SCOPE: 375, REVIEW_REQUIRED: 213, OUT_OF_SCOPE: 72 },
  discoverable: { IN_SCOPE: 55035, REVIEW_REQUIRED: 11271, OUT_OF_SCOPE: 874 },
  refreshEligible: {
    IN_SCOPE: 73025,
    REVIEW_REQUIRED: 11692,
    OUT_OF_SCOPE: 920,
  },
};

async function main() {
  const conn = await createConnection();
  try {
    const state = await conn.query(
      `SELECT policyVersion, updatedAt FROM assortment_policy_state WHERE id = 1`,
    );
    const policyVersion = Number(state[0]?.policyVersion || 0);

    const rules = await conn.query(
      `SELECT id, provider, matchType, pathPrefixNorm, categoryId, selectorKey,
              status, reasonCode, businessDomain, isActive
       FROM assortment_policy_rule ORDER BY id`,
    );
    const activeRules = rules.filter((r: any) => !!r.isActive);
    const duplicates = findDuplicateActiveSelectors(
      rules.map((r: any) => ({
        selectorKey: r.selectorKey,
        isActive: !!r.isActive,
        id: Number(r.id),
      })),
    );

    const byStatusCats = await conn.query(
      `SELECT status, COUNT(*) AS n
       FROM category_assortment_resolution
       GROUP BY status`,
    );
    const catCounts: Record<string, number> = {
      IN_SCOPE: 0,
      REVIEW_REQUIRED: 0,
      OUT_OF_SCOPE: 0,
    };
    for (const row of byStatusCats) {
      catCounts[row.status] = Number(row.n);
    }

    const unclassified = await conn.query(
      `SELECT COUNT(*) AS n FROM category_assortment_resolution
       WHERE reasonCode = 'UNCLASSIFIED'`,
    );

    const liveByStatus = await conn.query(
      `SELECT r.status, COUNT(*) AS n
       FROM product p
       JOIN category_assortment_resolution r ON r.categoryId = p.categoryId
       WHERE p.isDeleted = 0
       GROUP BY r.status`,
    );
    const live: Record<string, number> = {
      IN_SCOPE: 0,
      REVIEW_REQUIRED: 0,
      OUT_OF_SCOPE: 0,
    };
    for (const row of liveByStatus) live[row.status] = Number(row.n);

    // Discoverable ≈ product-bearing categories that appear in AUTO-MAP-0
    // style eligibility: live external curated with source identity.
    // TAXONOMY-SCOPE-1 used AUTO-MAP report own.total; we approximate with
    // the same refresh-adjacent predicate used for "discoverable" forensic
    // product-bearing set via live products on mapped report nodes.
    // Here we report live products by status (above) and a stricter
    // "refresh-eligible" count matching CatalogRefreshExecutor selection.
    const refreshByStatus = await conn.query(
      `SELECT r.status, COUNT(*) AS n
       FROM product p
       JOIN category_assortment_resolution r ON r.categoryId = p.categoryId
       WHERE p.isDeleted = 0
         AND p.supplyType = 'external_source'
         AND p.isCuratedExternalCatalog = 1
         AND p.source IS NOT NULL AND p.sourceId IS NOT NULL
         AND p.sourceAvailability <> 'removed'
       GROUP BY r.status`,
    );
    const refresh: Record<string, number> = {
      IN_SCOPE: 0,
      REVIEW_REQUIRED: 0,
      OUT_OF_SCOPE: 0,
    };
    for (const row of refreshByStatus) refresh[row.status] = Number(row.n);

    // Discoverable proxy: categories that have live products, counted as
    // product totals (matches SCOPE-1 "product-bearing" product sums).
    const discoverableByStatus = await conn.query(
      `SELECT r.status, COUNT(*) AS products
       FROM product p
       JOIN category_assortment_resolution r ON r.categoryId = p.categoryId
       WHERE p.isDeleted = 0
         AND EXISTS (
           SELECT 1 FROM product p2
           WHERE p2.categoryId = p.categoryId AND p2.isDeleted = 0
         )
       GROUP BY r.status`,
    );
    // The above is same as live — SCOPE-1 discoverable used AUTO-MAP node set.
    // Load AUTO-MAP report if present for exact comparison.
    let discoverable: Record<string, number> | null = null;
    let discoverableSource = 'live_products_fallback';
    try {
      const fs = await import('fs');
      const path = await import('path');
      const reportPath =
        process.env.AUTO_MAP_REPORT ||
        path.join(
          process.env.TEMP || '/tmp',
          'auto-map-0',
          'auto-map-0-report.json',
        );
      if (fs.existsSync(reportPath)) {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        const nodes: Array<{
          sourceCategoryId: number;
          own: { total: number };
        }> = report.nodes || [];
        const resRows = await conn.query(
          `SELECT categoryId, status FROM category_assortment_resolution`,
        );
        const statusByCat = new Map<number, string>();
        for (const r of resRows as Array<{
          categoryId: number;
          status: string;
        }>) {
          statusByCat.set(Number(r.categoryId), String(r.status));
        }
        const disc: Record<string, number> = {
          IN_SCOPE: 0,
          REVIEW_REQUIRED: 0,
          OUT_OF_SCOPE: 0,
        };
        for (const n of nodes) {
          const st = statusByCat.get(Number(n.sourceCategoryId));
          if (typeof st !== 'string') continue;
          if (disc[st] == null) disc[st] = 0;
          disc[st] += Number(n.own?.total || 0);
        }
        discoverable = disc;
        discoverableSource = reportPath;
      }
    } catch {
      // keep fallback
    }
    if (!discoverable) {
      discoverable = { ...live };
      void discoverableByStatus;
    }

    const domainBreakdown = await conn.query(
      `SELECT status, COALESCE(businessDomain, 'null') AS businessDomain,
              COUNT(*) AS categories,
              COALESCE(SUM(live.n), 0) AS liveProducts
       FROM category_assortment_resolution r
       LEFT JOIN (
         SELECT categoryId, COUNT(*) AS n FROM product WHERE isDeleted = 0 GROUP BY categoryId
       ) live ON live.categoryId = r.categoryId
       GROUP BY status, COALESCE(businessDomain, 'null')
       ORDER BY status, liveProducts DESC`,
    );

    const viaBreakdown = await conn.query(
      `SELECT via, status, COUNT(*) AS n
       FROM category_assortment_resolution
       GROUP BY via, status
       ORDER BY via, status`,
    );

    const changedSincePrevious = await conn.query(
      `SELECT afterJson FROM assortment_policy_audit
       WHERE operation = 'resolution_recompute'
       ORDER BY id DESC LIMIT 1`,
    );

    const orderSafety = await conn.query(
      `SELECT r.status, COUNT(DISTINCT oi.id) AS items, COUNT(DISTINCT oi.orderId) AS orders
       FROM order_item oi
       JOIN product p ON p.id = oi.productId
       JOIN category_assortment_resolution r ON r.categoryId = p.categoryId
       GROUP BY r.status`,
    );

    const categoryTotal = await conn.query(
      `SELECT COUNT(*) AS n FROM category`,
    );
    const resolutionTotal = await conn.query(
      `SELECT COUNT(*) AS n FROM category_assortment_resolution`,
    );

    const diff = {
      categories: {
        IN_SCOPE: catCounts.IN_SCOPE - FORENSIC.categories.IN_SCOPE,
        REVIEW_REQUIRED:
          catCounts.REVIEW_REQUIRED - FORENSIC.categories.REVIEW_REQUIRED,
        OUT_OF_SCOPE: catCounts.OUT_OF_SCOPE - FORENSIC.categories.OUT_OF_SCOPE,
      },
      discoverable: {
        IN_SCOPE: (discoverable.IN_SCOPE || 0) - FORENSIC.discoverable.IN_SCOPE,
        REVIEW_REQUIRED:
          (discoverable.REVIEW_REQUIRED || 0) -
          FORENSIC.discoverable.REVIEW_REQUIRED,
        OUT_OF_SCOPE:
          (discoverable.OUT_OF_SCOPE || 0) - FORENSIC.discoverable.OUT_OF_SCOPE,
      },
      refreshEligible: {
        IN_SCOPE: refresh.IN_SCOPE - FORENSIC.refreshEligible.IN_SCOPE,
        REVIEW_REQUIRED:
          refresh.REVIEW_REQUIRED - FORENSIC.refreshEligible.REVIEW_REQUIRED,
        OUT_OF_SCOPE:
          refresh.OUT_OF_SCOPE - FORENSIC.refreshEligible.OUT_OF_SCOPE,
      },
    };

    const materialCategoryDiff =
      Math.abs(diff.categories.IN_SCOPE) +
        Math.abs(diff.categories.REVIEW_REQUIRED) +
        Math.abs(diff.categories.OUT_OF_SCOPE) >
      0;

    const report = {
      shadowMode: true,
      policyVersion,
      ruleCount: rules.length,
      activeRuleCount: activeRules.length,
      categoryCount: Number(categoryTotal[0].n),
      resolutionCount: Number(resolutionTotal[0].n),
      categoriesByStatus: catCounts,
      liveProductsByStatus: live,
      discoverableProductsByStatus: discoverable,
      discoverableSource,
      refreshEligibleByStatus: refresh,
      unclassifiedCount: Number(unclassified[0].n),
      duplicateActiveSelectors: duplicates,
      domainBreakdown,
      viaBreakdown,
      lastRecomputeAudit: changedSincePrevious[0]?.afterJson || null,
      orderSafety,
      forensicBaseline: FORENSIC,
      diffVsForensic: diff,
      materialCategoryDiff,
      ok:
        !materialCategoryDiff &&
        duplicates.length === 0 &&
        Number(resolutionTotal[0].n) === Number(categoryTotal[0].n),
    };

    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
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
