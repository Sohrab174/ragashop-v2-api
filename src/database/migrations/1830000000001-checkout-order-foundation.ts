import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addColumnIfMissing,
  addUniqueIndexIfMissing,
  columnExists,
  dropColumnIfExists,
  dropIndexIfExists,
} from '../migration-utils';

/**
 * Checkout-1 foundation (additive only):
 * - Order guest access token + checkout idempotency key
 * - OrderItem commercial snapshots (name / option labels)
 * - Cart lastConvertedOrderId for post-conversion lifecycle
 * - Widen order.addressDetails for delivery detail text
 *
 * No business rows deleted. No destructive catalog changes.
 */
export class checkoutOrderFoundation1830000000001
  implements MigrationInterface
{
  name = 'checkoutOrderFoundation1830000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await addColumnIfMissing(
      queryRunner,
      'order',
      'guestAccessToken',
      '`guestAccessToken` varchar(64) NULL',
    );
    await addUniqueIndexIfMissing(
      queryRunner,
      'order',
      'uq_order_guestAccessToken',
      '`guestAccessToken`',
    );

    await addColumnIfMissing(
      queryRunner,
      'order',
      'checkoutIdempotencyKey',
      '`checkoutIdempotencyKey` varchar(64) NULL',
    );
    await addUniqueIndexIfMissing(
      queryRunner,
      'order',
      'uq_order_checkoutIdempotencyKey',
      '`checkoutIdempotencyKey`',
    );

    await addColumnIfMissing(
      queryRunner,
      'order_item',
      'productName',
      '`productName` varchar(255) NULL',
    );
    await addColumnIfMissing(
      queryRunner,
      'order_item',
      'optionName',
      '`optionName` varchar(128) NULL',
    );
    await addColumnIfMissing(
      queryRunner,
      'order_item',
      'optionLabel',
      '`optionLabel` varchar(255) NULL',
    );

    await addColumnIfMissing(
      queryRunner,
      'cart',
      'lastConvertedOrderId',
      '`lastConvertedOrderId` int NULL',
    );

    if (await columnExists(queryRunner, 'order', 'addressDetails')) {
      await queryRunner.query(
        `ALTER TABLE \`order\` MODIFY COLUMN \`addressDetails\` varchar(255) NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await dropIndexIfExists(
      queryRunner,
      'order',
      'uq_order_checkoutIdempotencyKey',
    );
    await dropIndexIfExists(queryRunner, 'order', 'uq_order_guestAccessToken');
    await dropColumnIfExists(queryRunner, 'order', 'checkoutIdempotencyKey');
    await dropColumnIfExists(queryRunner, 'order', 'guestAccessToken');
    await dropColumnIfExists(queryRunner, 'order_item', 'optionLabel');
    await dropColumnIfExists(queryRunner, 'order_item', 'optionName');
    await dropColumnIfExists(queryRunner, 'order_item', 'productName');
    await dropColumnIfExists(queryRunner, 'cart', 'lastConvertedOrderId');

    if (await columnExists(queryRunner, 'order', 'addressDetails')) {
      await queryRunner.query(
        `ALTER TABLE \`order\` MODIFY COLUMN \`addressDetails\` varchar(45) NULL`,
      );
    }
  }
}
