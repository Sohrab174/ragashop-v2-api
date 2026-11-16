/**
 * One-shot LOCAL remap of the seven smoke-verified discount pool products
 * from Phase-2 English orphan categories to supported Turkish/Persian leaves.
 *
 * Requires: DISCOUNT_ENGINE_EXPECTED_DATABASE=ragashop_local
 * Does not touch Production. Does not delete categories 1037–1041.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { Connection } from 'typeorm';
import { AppModule } from '../../app.module';
import {
  assertExpectedDatabaseName,
  resolveExpectedDatabaseFromEnv,
} from '../../modules/catalog-lifecycle/discount-engine.db-guard';
import { resolveKnownDiscountCategoryId } from '../../modules/catalog-lifecycle/discount-category-resolve.util';

async function main() {
  const expected = resolveExpectedDatabaseFromEnv();
  if (!expected) {
    throw new Error('Set DISCOUNT_ENGINE_EXPECTED_DATABASE=ragashop_local');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const ds = app.get(Connection);
    const dbRows = await ds.query('SELECT DATABASE() AS db');
    assertExpectedDatabaseName(dbRows?.[0]?.db, expected);

    const pool = await ds.query(
      `SELECT p.id AS poolId, p.productId, p.categoryName, p.status,
              pr.categoryId AS oldCategoryId, pr.price, pr.discountedPrice,
              pr.discountDisplayExpiresAt, pr.sourceAvailability, pr.sourceSyncStatus
       FROM discount_discovery_pool p
       JOIN product pr ON pr.id = p.productId
       WHERE p.status = 'active'
       ORDER BY p.id`,
    );

    const plan = pool
      .map((row: any) => {
        const to = resolveKnownDiscountCategoryId(row.categoryName);
        return {
          productId: row.productId,
          poolId: row.poolId,
          listingCategoryName: row.categoryName,
          oldCategoryId: row.oldCategoryId,
          newCategoryId: to,
          skip:
            to == null || Number(row.oldCategoryId) === Number(to)
              ? to == null
                ? 'unknown_listing_category'
                : 'already_mapped'
              : null,
        };
      })
      .filter((r) => r.skip == null);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(
      process.cwd(),
      `.tmp-discount-smoke-category-remap-backup-${stamp}.json`,
    );
    fs.writeFileSync(
      backupPath,
      JSON.stringify({ database: expected, at: stamp, pool, plan }, null, 2),
    );

    const updated: any[] = [];
    for (const row of plan) {
      await ds.query(
        `UPDATE product SET categoryId = ? WHERE id = ? AND categoryId = ?`,
        [row.newCategoryId, row.productId, row.oldCategoryId],
      );
      updated.push(row);
    }

    console.log(
      JSON.stringify(
        {
          database: expected,
          backupPath,
          planned: plan.length,
          updated,
          unchangedOrSkipped: pool.length - plan.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
