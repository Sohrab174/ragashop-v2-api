import { Connection } from 'typeorm';

const FIXTURE_PREFIX = 'P1A_TEST_';

export type CommerceTestFixture = {
  productId: number;
  originalQuantity: number | null;
  orderId: number;
  transactionId: number;
  finalizationInserted: boolean;
};

export async function createIsolatedCommerceFixture(
  connection: Connection,
): Promise<CommerceTestFixture> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

  const categoryRows = await connection.query(
    `SELECT categoryId FROM product WHERE categoryId IS NOT NULL LIMIT 1`,
  );
  if (!categoryRows.length) {
    throw new Error('No category fixture available for commerce tests');
  }
  const categoryId = categoryRows[0].categoryId;

  const productInsert = await connection.query(
    `INSERT INTO product (categoryId, name, price, discountedPrice, quantity, status, isDeleted, createdAt, displayOrder, currency)
     VALUES (?, ?, 10000, NULL, 5, 'active', 0, NOW(), 1, 'TRY')`,
    [categoryId, `${FIXTURE_PREFIX}product_${suffix}`],
  );
  const productId = productInsert.insertId;

  const customerRows = await connection.query(
    `SELECT id FROM customer WHERE isDeleted = 0 LIMIT 1`,
  );
  if (!customerRows.length) {
    throw new Error('No customer fixture available for commerce tests');
  }
  const customerId = customerRows[0].id;

  const cityRows = await connection.query(`SELECT id FROM city LIMIT 1`);
  const cityId = cityRows[0]?.id ?? null;

  const orderInsert = await connection.query(
    `INSERT INTO \`order\` (customerId, number, amount, discount, shipping, tax, finalAmount, address, status, createdAt, cityId)
     VALUES (?, ?, 10000, 0, 0, 0, 10000, 'test address', 'pending', NOW(), ?)`,
    [customerId, `${FIXTURE_PREFIX}order_${suffix}`, cityId],
  );
  const orderId = orderInsert.insertId;

  const gatewayRows = await connection.query(
    `SELECT id FROM gateway WHERE isDeleted = 0 LIMIT 1`,
  );
  if (!gatewayRows.length) {
    throw new Error('No gateway fixture available for commerce tests');
  }

  const txInsert = await connection.query(
    `INSERT INTO transaction (orderId, customerId, gatewayId, amount, walletAmount, walletIRT, walletTRY, walletUSD, reduceCardAmount, status, gatewaySessionStatus, ip, createdAt)
     VALUES (?, ?, ?, 10000, 0, 0, 0, 0, 0, 'pending', 'not_started', '127.0.0.1', NOW())`,
    [orderId, customerId, gatewayRows[0].id],
  );

  return {
    productId,
    originalQuantity: 5,
    orderId,
    transactionId: txInsert.insertId,
    finalizationInserted: false,
  };
}

export async function cleanupCommerceFixture(
  connection: Connection,
  fixture: CommerceTestFixture,
): Promise<void> {
  const errors: string[] = [];

  const safe = async (label: string, sql: string, params: unknown[] = []) => {
    try {
      await connection.query(sql, params);
    } catch (err) {
      errors.push(`${label}: ${err?.message || err}`);
    }
  };

  if (fixture.finalizationInserted) {
    await safe(
      'finalization',
      `DELETE FROM order_payment_finalization WHERE orderId = ?`,
      [fixture.orderId],
    );
  }

  await safe('transaction', `DELETE FROM transaction WHERE id = ?`, [
    fixture.transactionId,
  ]);
  await safe('order', `DELETE FROM \`order\` WHERE id = ?`, [fixture.orderId]);

  if (fixture.originalQuantity != null) {
    await safe(
      'product_quantity_restore',
      `UPDATE product SET quantity = ? WHERE id = ?`,
      [fixture.originalQuantity, fixture.productId],
    );
  }

  await safe('product', `DELETE FROM product WHERE id = ?`, [
    fixture.productId,
  ]);

  if (errors.length) {
    throw new Error(`Fixture cleanup failed: ${errors.join('; ')}`);
  }
}
