/**
 * One-off bootstrap for the FIRST Admin user in the isolated UAT database.
 *
 * Refuse to run unless DATABASE_NAME matches the required UAT database
 * (default ragashop_v2_uat). Does not print passwords.
 *
 * Usage (from ragashop-api, with UAT env already exported):
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/uat-bootstrap-admin.ts
 *
 * Required env:
 *   DATABASE_* (pointing at ragashop_v2_uat)
 *   UAT_BOOTSTRAP_ADMIN_EMAIL
 *   UAT_BOOTSTRAP_ADMIN_MOBILE
 *   UAT_BOOTSTRAP_ADMIN_PASSWORD
 *   UAT_BOOTSTRAP_ADMIN_FIRST_NAME (optional)
 *   UAT_BOOTSTRAP_ADMIN_LAST_NAME (optional)
 */

import * as dotenv from 'dotenv';
import { createConnection } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import {
  DEFAULT_UAT_DATABASE_NAME,
  resolveUatRequiredDatabaseName,
} from '../../security/uat-fixed-otp.util';

dotenv.config();

function requireEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main() {
  const databaseName = String(process.env.DATABASE_NAME || '').trim();
  const required = resolveUatRequiredDatabaseName(process.env);
  if (!databaseName || databaseName.toLowerCase() !== required) {
    throw new Error(
      `Refusing bootstrap: DATABASE_NAME must be isolated UAT database '${required}' ` +
        `(got '${databaseName || '(empty)'}').`,
    );
  }

  const email = requireEnv('UAT_BOOTSTRAP_ADMIN_EMAIL');
  const mobile = requireEnv('UAT_BOOTSTRAP_ADMIN_MOBILE');
  const password = requireEnv('UAT_BOOTSTRAP_ADMIN_PASSWORD');
  const firstName = String(process.env.UAT_BOOTSTRAP_ADMIN_FIRST_NAME || 'UAT').trim();
  const lastName = String(process.env.UAT_BOOTSTRAP_ADMIN_LAST_NAME || 'Admin').trim();

  const connection = await createConnection({
    type: (process.env.DATABASE_TYPE as any) || 'mysql',
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: parseInt(process.env.DATABASE_PORT || '3306', 10),
    username: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: databaseName,
  });

  try {
    const existing = await connection.query(
      `SELECT id, role FROM \`user\` WHERE (email = ? OR mobile = ?) AND isDeleted = 0 LIMIT 5`,
      [email, mobile],
    );
    if (existing.length > 0) {
      console.log(
        JSON.stringify({
          ok: true,
          skipped: true,
          reason: 'admin_already_exists',
          ids: existing.map((r: { id: number }) => r.id),
        }),
      );
      return;
    }

    const salt = await bcrypt.genSalt();
    const hashed = await bcrypt.hash(password, salt);
    const now = new Date();

    const result = await connection.query(
      `INSERT INTO \`user\`
        (\`email\`, \`mobile\`, \`password\`, \`firstName\`, \`lastName\`, \`role\`, \`status\`, \`isDeleted\`, \`createdAt\`)
       VALUES (?, ?, ?, ?, ?, 'admin', 'active', 0, ?)`,
      [email, mobile, hashed, firstName, lastName, now],
    );

    console.log(
      JSON.stringify({
        ok: true,
        created: true,
        database: databaseName,
        adminId: result.insertId,
        email,
        mobile,
        role: 'admin',
        note: 'password not logged',
      }),
    );
  } finally {
    await connection.close();
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : 'bootstrap_failed',
      expectedDatabase: DEFAULT_UAT_DATABASE_NAME,
    }),
  );
  process.exit(1);
});
