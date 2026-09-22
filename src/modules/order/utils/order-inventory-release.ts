import { QueryRunner } from 'typeorm';
import { ProductService } from '../../product/product.service';
import { OrderItemEntity } from '../entities/order-item.entity';
import { OrderStatus } from '../entities/order.entity';

/**
 * Identity for restoring inventory reserved at pending-order creation.
 * Mirrors CheckoutService / OrderService.addUpdate decrement selection:
 *   productAttributeValueId ? PAV bucket : product bucket
 * Never both.
 */
export type ReservedInventoryLine = Pick<
  OrderItemEntity,
  'productId' | 'productAttributeValueId' | 'quantity'
>;

/**
 * Inventory is still reserved iff the order remains pending.
 * Payment finalization transitions pending → paid (consumes reservation).
 * Unpaid reject/delete/cleanup release only from pending, and only when
 * financial preservation evidence is absent (see isInventoryReleaseBlocked).
 */
export function isInventoryStillReserved(status: OrderStatus): boolean {
  return status === OrderStatus.pending;
}

/**
 * Restore each line to the same XOR bucket decremented at create.
 * Caller must hold an open transaction that also owns the order-row lock.
 */
export async function restoreReservedInventoryLines(
  productService: Pick<
    ProductService,
    'incrementQuantity' | 'incrementAttributeQuantity'
  >,
  lines: ReservedInventoryLine[],
  queryRunner: QueryRunner,
): Promise<void> {
  for (const line of lines) {
    if (line.productAttributeValueId) {
      await productService.incrementAttributeQuantity(
        line.productAttributeValueId,
        line.quantity,
        queryRunner,
      );
    } else {
      await productService.incrementQuantity(
        line.productId,
        line.quantity,
        queryRunner,
      );
    }
  }
}
