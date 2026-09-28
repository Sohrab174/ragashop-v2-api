import * as fs from 'fs';
import * as path from 'path';
import { getMetadataArgsStorage } from 'typeorm';

/**
 * Entities must never pin a database/schema: every table has to resolve
 * against the configured DATABASE_NAME so local, staging and production
 * stay isolated even when they share a MySQL server.
 */
const SRC_ROOT = path.resolve(__dirname, '..');

function listEntityFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listEntityFiles(full));
    } else if (entry.name.endsWith('.entity.ts')) {
      out.push(full);
    }
  }
  return out;
}

const entityFiles = listEntityFiles(SRC_ROOT);

function loadEntities() {
  for (const file of entityFiles) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require(file);
  }
}

describe('entity database isolation', () => {
  it('discovers entity files', () => {
    expect(entityFiles.length).toBeGreaterThan(0);
  });

  it('no entity source pins a schema or database', () => {
    const offenders = entityFiles.filter((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return /\b(schema|database)\s*:\s*['"`]/.test(source);
    });
    expect(offenders.map((f) => path.relative(SRC_ROOT, f))).toEqual([]);
  });

  it('registered TypeORM tables carry no schema/database qualifier', () => {
    loadEntities();
    const tables = getMetadataArgsStorage().tables;
    expect(tables.length).toBeGreaterThan(0);
    const qualified = tables
      .filter((t) => t.schema !== undefined || t.database !== undefined)
      .map((t) => String(t.name));
    expect(qualified).toEqual([]);
  });

  it.each([
    'order_status',
    'nav_menu',
    'page_section',
    'page_section_item',
    'wallet_history',
  ])('%s is registered unqualified', (tableName) => {
    loadEntities();
    const table = getMetadataArgsStorage().tables.find(
      (t) => t.name === tableName,
    );
    expect(table).toBeDefined();
    expect(table.schema).toBeUndefined();
    expect(table.database).toBeUndefined();
  });
});
