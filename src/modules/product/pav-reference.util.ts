import { EntityManager } from 'typeorm';

/** OrderItem-referenced PAV ids for a Product — must not be lifecycle-destructively mutated. */
export async function loadOrderReferencedPavIds(
  manager: EntityManager,
  productId: number,
): Promise<Set<number>> {
  const rows = await manager.query(
    `SELECT DISTINCT productAttributeValueId AS pavId
     FROM order_item
     WHERE productId = ? AND productAttributeValueId IS NOT NULL`,
    [productId],
  );
  const ids = new Set<number>();
  for (const row of rows || []) {
    const id = Number(row.pavId ?? row.pavid);
    if (id > 0) {
      ids.add(id);
    }
  }
  return ids;
}
