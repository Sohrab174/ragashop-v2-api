/**
 * LOCAL-ONLY: re-stamp the existing local TRY→IRR rate as freshly checked so human
 * checkout review can pass the stale-FX guard. Does NOT call TGJU, does NOT change
 * the rate or its source, does NOT touch orders/payments/financial events/inventory,
 * and refuses to run outside ragashop_local on this machine. The freshness window
 * still applies: re-run before each review checkout.
 *
 *   npm run local:fx:restamp -- --confirm-local
 */
import 'dotenv/config';
import { hostname } from 'os';
import * as mysql from 'mysql2/promise';
import {
  localFxRestampRefusal,
  runLocalFxRestamp,
} from './local-fx-restamp.guard';

async function main() {
  const refusal = localFxRestampRefusal(process.env, process.argv.slice(2));
  if (refusal) {
    console.error(`[local-fx-restamp] REFUSED: ${refusal}`);
    process.exit(2);
  }

  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  });

  try {
    const report = await runLocalFxRestamp(
      {
        query: async (sql, params) => (await conn.query(sql, params))[0],
      },
      {
        machineHostname: hostname(),
        beforeWrite: (current) =>
          console.log(
            `[local-fx-restamp] target ${process.env.DATABASE_HOST}:${
              process.env.DATABASE_PORT || 3306
            }/${current.database} @ ${
              current.serverHostname
            }; current tryToRial=${
              current.tryToRial
            }; previous tryToRialFetchedAt=${
              current.previousFetchedAt?.toISOString() ?? 'null'
            }`,
          ),
      },
    );
    console.log(
      JSON.stringify(
        {
          ...report,
          target: `${process.env.DATABASE_HOST}:${
            process.env.DATABASE_PORT || 3306
          }/${report.database} @ ${report.serverHostname}`,
          previousFetchedAtLocal: report.previousFetchedAt?.toString() ?? null,
          newFetchedAtLocal: report.newFetchedAt.toString(),
        },
        null,
        2,
      ),
    );
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(`[local-fx-restamp] FAILED: ${e.message}`);
  process.exit(1);
});
