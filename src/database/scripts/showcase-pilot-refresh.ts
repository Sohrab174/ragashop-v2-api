/**
 * Local CLI for the Phase-1 targeted showcase pilot.
 *
 * Dry-run (default, no enqueue / no Trendyol):
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/showcase-pilot-refresh.ts
 *
 * Controlled live enqueue (requires explicit env + --live):
 *   set SHOWCASE_PILOT_LIVE_ENABLED=true
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/showcase-pilot-refresh.ts --live
 *
 * Optional custom allowlist (≤40):
 *   ... showcase-pilot-refresh.ts --ids=97532,97509
 *
 * Does NOT start Nest schedulers. Uses existing marketplace import jobs/workers
 * only when --live is authorized.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { ShowcasePilotRefreshService } from '../../modules/catalog-lifecycle/showcase-pilot-refresh.service';
import { SHOWCASE_PILOT_DEFAULT_PRODUCT_IDS } from '../../modules/catalog-lifecycle/showcase-pilot.constants';

function parseArgs(argv: string[]) {
  const live = argv.includes('--live');
  const idsArg = argv.find((a) => a.startsWith('--ids='));
  let productIds: number[] | undefined;
  if (idsArg) {
    productIds = idsArg
      .slice('--ids='.length)
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((v) => Number(v));
  }
  return {
    mode: live ? ('live' as const) : ('dry_run' as const),
    productIds: productIds?.length
      ? productIds
      : [...SHOWCASE_PILOT_DEFAULT_PRODUCT_IDS],
  };
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const pilot = app.get(ShowcasePilotRefreshService);
    const report = await pilot.execute(input);
    console.log(JSON.stringify(report, null, 2));
    if (input.mode === 'live' && report.liveBlockedReason) {
      process.exitCode = 2;
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
