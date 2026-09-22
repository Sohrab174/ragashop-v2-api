/**
 * Local dry-run for Phase A3 catalog refresh selection.
 * Does NOT enqueue crawler jobs or contact external retailers.
 *
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/catalog-refresh-dry-run.ts
 */
import * as mysql from 'mysql2/promise';
import { loadCatalogLifecycleRuntimeConfig } from '../../modules/catalog-lifecycle/catalog-lifecycle.config';
import { evaluateCatalogRefreshEligibility } from '../../modules/catalog-lifecycle/catalog-refresh-eligibility';
import { ProductSupplyType } from '../../modules/catalog-lifecycle/catalog-lifecycle.types';
import { SourceCommercialAvailability } from '../../modules/source-availability';

async function main() {
  const config = loadCatalogLifecycleRuntimeConfig();
  const maxItems = Math.min(
    Number(process.env.CATALOG_REFRESH_DRY_RUN_MAX || config.defaultBatchSize),
    config.hardMaxItemsPerRun,
  );
  const sourceFilter = process.env.CATALOG_REFRESH_DRY_RUN_SOURCE || null;
  const windowLimit = Math.min(
    Math.max(maxItems * 8, 200),
    config.maxCandidateWindow,
  );

  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: process.env.DATABASE_NAME || 'ragashop_local',
  });

  try {
    const [supplyCounts] = await conn.query<any[]>(
      `SELECT supplyType, isCuratedExternalCatalog, COUNT(*) AS c
       FROM product GROUP BY supplyType, isCuratedExternalCatalog`,
    );
    const [curatedCountRows] = await conn.query<any[]>(
      `SELECT COUNT(*) AS c FROM product
       WHERE supplyType = 'external_source'
         AND isCuratedExternalCatalog = 1
         AND isDeleted = 0`,
    );
    const [nonCuratedExternalRows] = await conn.query<any[]>(
      `SELECT COUNT(*) AS c FROM product
       WHERE supplyType = 'external_source'
         AND isCuratedExternalCatalog = 0
         AND isDeleted = 0`,
    );

    const params: any[] = [
      ProductSupplyType.external_source,
      SourceCommercialAvailability.removed,
    ];
    let sourceClause = '';
    if (sourceFilter) {
      sourceClause = 'AND source = ?';
      params.push(sourceFilter);
    }
    params.push(windowLimit);

    const sql = `
      SELECT id, source, sourceId, sourceUrl, supplyType, isCuratedExternalCatalog,
             sourceAvailability, sourceSyncStatus, availabilityLastConfirmedAt,
             sourceLastAttemptAt, createdAt, price, discountedPrice
      FROM product
      WHERE supplyType = ?
        AND isCuratedExternalCatalog = 1
        AND isDeleted = 0
        AND source IS NOT NULL AND source <> ''
        AND sourceId IS NOT NULL AND sourceId <> ''
        AND sourceAvailability <> ?
        ${sourceClause}
      ORDER BY id ASC
      LIMIT ?
    `;

    const [rows] = await conn.query<any[]>(sql, params);
    const now = new Date();

    const [activeJobs] = await conn.query<any[]>(
      `SELECT source, sourceProductId FROM marketplace_import_job
       WHERE status IN ('queued','processing','retry_wait')
       LIMIT 5000`,
    );
    const activeDedup = new Set(
      (activeJobs as any[]).map((j) => `${j.source}:${j.sourceProductId}`),
    );
    const activePerSource = new Map<string, number>();
    for (const j of activeJobs as any[]) {
      activePerSource.set(j.source, (activePerSource.get(j.source) || 0) + 1);
    }

    const selected: any[] = [];
    const selectedPerSource = new Map<string, number>();
    const bySource = new Map<string, number>();
    const byAvailability = new Map<string, number>();
    const bySync = new Map<string, number>();
    const freshness = {
      neverVerifiedOrUnknown: 0,
      sourceErrorEligible: 0,
      availableStaleEligible: 0,
      unavailableRecheckEligible: 0,
      otherEligible: 0,
    };
    let skippedActiveDedup = 0;
    let skippedPerSourceConcurrency = 0;

    const eligiblePool: Array<{
      row: any;
      decision: ReturnType<typeof evaluateCatalogRefreshEligibility>;
    }> = [];

    for (const row of rows as any[]) {
      const decision = evaluateCatalogRefreshEligibility(
        {
          id: row.id,
          source: row.source,
          sourceId: row.sourceId,
          sourceUrl: row.sourceUrl,
          supplyType: row.supplyType,
          isCuratedExternalCatalog: Boolean(row.isCuratedExternalCatalog),
          sourceAvailability: row.sourceAvailability,
          sourceSyncStatus: row.sourceSyncStatus,
          availabilityLastConfirmedAt: row.availabilityLastConfirmedAt,
          sourceLastAttemptAt: row.sourceLastAttemptAt,
          createdAt: row.createdAt,
          price: row.price != null ? Number(row.price) : null,
          discountedPrice:
            row.discountedPrice != null ? Number(row.discountedPrice) : null,
        },
        now,
        config,
      );
      if (!decision.eligible || !decision.reason || !decision.priorityClass) {
        continue;
      }
      eligiblePool.push({ row, decision });
    }

    eligiblePool.sort((a, b) => {
      if (b.decision.priority !== a.decision.priority) {
        return b.decision.priority - a.decision.priority;
      }
      const aAt = a.row.availabilityLastConfirmedAt
        ? new Date(a.row.availabilityLastConfirmedAt).getTime()
        : 0;
      const bAt = b.row.availabilityLastConfirmedAt
        ? new Date(b.row.availabilityLastConfirmedAt).getTime()
        : 0;
      if (aAt !== bAt) return aAt - bAt;
      return a.row.id - b.row.id;
    });

    for (const { row, decision } of eligiblePool) {
      if (selected.length >= maxItems) break;
      const key = `${row.source}:${row.sourceId}`;
      if (activeDedup.has(key)) {
        skippedActiveDedup += 1;
        continue;
      }
      const alreadySelected = selectedPerSource.get(row.source) || 0;
      const alreadyActive = activePerSource.get(row.source) || 0;
      if (alreadySelected + alreadyActive >= config.maxConcurrencyPerSource) {
        skippedPerSourceConcurrency += 1;
        continue;
      }
      selected.push({
        productId: row.id,
        source: row.source,
        sourceId: row.sourceId,
        reason: decision.reason,
        priorityClass: decision.priorityClass,
        tier: decision.tier,
        priority: decision.priority,
        currentlyDiscounted: decision.currentlyDiscounted,
        sourceAvailability: row.sourceAvailability,
        sourceSyncStatus: row.sourceSyncStatus,
        detail: decision.detail,
      });
      selectedPerSource.set(row.source, alreadySelected + 1);
      bySource.set(row.source, (bySource.get(row.source) || 0) + 1);
      byAvailability.set(
        row.sourceAvailability,
        (byAvailability.get(row.sourceAvailability) || 0) + 1,
      );
      bySync.set(
        row.sourceSyncStatus,
        (bySync.get(row.sourceSyncStatus) || 0) + 1,
      );
      if (
        decision.reason === 'never_verified' ||
        decision.reason === 'unknown_availability'
      ) {
        freshness.neverVerifiedOrUnknown += 1;
      } else if (decision.reason === 'source_error_recheck') {
        freshness.sourceErrorEligible += 1;
      } else if (
        decision.reason === 'available_stale' ||
        decision.reason === 'available_stale_discount' ||
        decision.reason === 'available_stale_demand'
      ) {
        freshness.availableStaleEligible += 1;
      } else if (decision.reason === 'unavailable_recheck') {
        freshness.unavailableRecheckEligible += 1;
      } else {
        freshness.otherEligible += 1;
      }
    }

    const report = {
      mode: 'dry_run',
      liveEnqueueAttempted: false,
      liveEnqueueBlockedReason: null,
      configuredHardMaxItems: config.hardMaxItemsPerRun,
      requestedMaxItems: maxItems,
      effectiveMaxItems: maxItems,
      sourceFilter,
      backgroundPaused: config.backgroundPaused,
      liveEnqueueEnabled: config.liveEnqueueEnabled,
      maxConcurrencyPerSource: config.maxConcurrencyPerSource,
      supplyCounts,
      nonCuratedExternalApprox: Number(nonCuratedExternalRows[0]?.c || 0),
      totals: {
        curatedExternal: Number(curatedCountRows[0]?.c || 0),
        eligible: selected.length,
        projectedJobs: selected.length,
        enqueuedJobs: 0,
        skippedActiveDedup,
        skippedPerSourceConcurrency,
        candidateWindowScanned: (rows as any[]).length,
      },
      bySource: [...bySource.entries()].map(([source, eligible]) => ({
        source,
        eligible,
      })),
      byAvailability: [...byAvailability.entries()].map(
        ([sourceAvailability, count]) => ({ sourceAvailability, count }),
      ),
      bySyncStatus: [...bySync.entries()].map(([sourceSyncStatus, count]) => ({
        sourceSyncStatus,
        count,
      })),
      freshnessBuckets: freshness,
      samples: selected.slice(0, config.dryRunSampleSize),
      capacity: {
        externalCatalogTargetSize: config.externalCatalogTargetSize,
        externalCatalogMaxSize: config.externalCatalogMaxSize,
        curatedActiveApprox: Number(curatedCountRows[0]?.c || 0),
      },
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
