const mysql = require("mysql2/promise");

async function main() {
  const c = await mysql.createConnection({
    host: "127.0.0.1",
    port: 3306,
    user: "root",
    password: "",
    database: "ragashop_local",
  });

  await c.execute(
    "UPDATE storefront_home_section SET enabled=0, displayOrder=15, updatedAt=NOW() WHERE sectionKey='categories'",
  );
  await c.execute(
    "UPDATE storefront_home_section SET enabled=1, displayOrder=14, title=?, updatedAt=NOW() WHERE sectionKey='paste_link'",
    ["شروع خرید"],
  );
  await c.execute(
    "UPDATE storefront_home_section SET enabled=1, displayOrder=22, title=?, updatedAt=NOW() WHERE sectionKey='featured_brands'",
    ["برندهای منتخب"],
  );

  // Record migration as applied if migrations table exists
  try {
    await c.execute(
      "INSERT IGNORE INTO migrations(timestamp, name) VALUES (?, ?)",
      [1920000000009, "phaseHome5aFinalComposition1920000000009"],
    );
  } catch {
    // ignore if schema differs
  }

  const [rows] = await c.execute(
    "SELECT sectionKey, enabled, displayOrder, title FROM storefront_home_section ORDER BY displayOrder",
  );
  console.table(rows);
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
