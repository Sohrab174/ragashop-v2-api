/**
 * Operator CLI for the daily discount engine.
 *
 * Dry-run (default — no PDP, no listing unless flagged):
 *   set DISCOUNT_ENGINE_EXPECTED_DATABASE=ragashop_local
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/discount-engine-run.ts
 *
 * Dry-run with live listing probes (no PDP):
 *   set DISCOUNT_ENGINE_LIVE_LISTING=true
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/discount-engine-run.ts --live-listing
 *
 * Controlled live PDP (explicit env + flag):
 *   set DISCOUNT_ENGINE_LIVE_ENABLED=true
 *   set DISCOUNT_ENGINE_EXPECTED_DATABASE=ragashop_local
 *   set MARKETPLACE_JOB_MAX_ATTEMPTS=1
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/discount-engine-run.ts --live
 *
 * Does NOT enable global crawler cron.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Connection } from 'typeorm';
import { AppModule } from '../../app.module';
import { DiscountEngineService } from '../../modules/catalog-lifecycle/discount-engine.service';
import {
  assertExpectedDatabaseName,
  resolveExpectedDatabaseFromEnv,
} from '../../modules/catalog-lifecycle/discount-engine.db-guard';

function parseArgs(argv: string[]) {
  const live = argv.includes('--live');
  const liveListing = argv.includes('--live-listing');
  return {
    mode: live ? ('live' as const) : ('dry_run' as const),
    liveListing,
  };
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  const expected = resolveExpectedDatabaseFromEnv();
  // Local smoke / operator runs must declare the expected DB before any work.
  if (!expected) {
    throw new Error(
      'Refusing to start: set DISCOUNT_ENGINE_EXPECTED_DATABASE (e.g. ragashop_local)',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const connection = app.get(Connection);
    const rows = await connection.query('SELECT DATABASE() AS db');
    const actual = rows?.[0]?.db ?? null;
    assertExpectedDatabaseName(actual, expected);

    const engine = app.get(DiscountEngineService);
    const report = await engine.execute(input);
    console.log(JSON.stringify(report, null, 2));
    if (input.mode === 'live' && (report as any).liveBlockedReason) {
      process.exitCode = 2;
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
