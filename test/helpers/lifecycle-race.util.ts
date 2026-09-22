import { Connection } from 'typeorm';
import { ProductStatus } from '../../src/modules/product/entities/product.entity';

export interface ChildCountBaseline {
  attachedGallery: number;
  activePav: number;
  adminDesc: number;
}

export async function snapshotChildBaseline(
  connection: Connection,
  productId: number,
): Promise<ChildCountBaseline> {
  const gallery = await connection.query(
    `SELECT COUNT(*) AS cnt FROM product_gallery WHERE productId = ?`,
    [productId],
  );
  const pav = await connection.query(
    `SELECT COUNT(*) AS cnt FROM product_attribute_value WHERE productId = ? AND isDeleted = 0`,
    [productId],
  );
  const desc = await connection.query(
    `SELECT COUNT(*) AS cnt FROM product_description WHERE productId = ? AND source IS NULL AND isDeleted = 0`,
    [productId],
  );
  return {
    attachedGallery: Number(gallery[0].cnt),
    activePav: Number(pav[0].cnt),
    adminDesc: Number(desc[0].cnt),
  };
}

export async function assertDeletedProductRaceInvariants(
  connection: Connection,
  productId: number,
  baseline: ChildCountBaseline,
): Promise<void> {
  const product = await connection.query(
    `SELECT isDeleted, status FROM product WHERE id = ?`,
    [productId],
  );
  expect(product[0].isDeleted).toBe(1);
  expect(product[0].status).not.toBe(ProductStatus.active);

  const current = await snapshotChildBaseline(connection, productId);
  expect(current.attachedGallery).toBeLessThanOrEqual(baseline.attachedGallery);
  expect(current.activePav).toBeLessThanOrEqual(baseline.activePav);
  expect(current.adminDesc).toBeLessThanOrEqual(baseline.adminDesc);

  const fav = await connection.query(
    `SELECT COUNT(*) AS cnt FROM product_favorite WHERE productId = ? AND isDeleted = 0`,
    [productId],
  );
  expect(Number(fav[0].cnt)).toBe(0);
}

export async function closeAllTypeOrmConnections(): Promise<void> {
  const { getConnectionManager } = await import('typeorm');
  const manager = getConnectionManager();
  await Promise.all(
    manager.connections.map(async (conn) => {
      if (conn.isConnected) {
        await conn.close();
      }
    }),
  );
}
