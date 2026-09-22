import { createConnection, Connection } from 'typeorm';
import { ProductService } from '../src/modules/product/product.service';
import { ProductEntity } from '../src/modules/product/entities/product.entity';
import { ProductAttributeValueEntity } from '../src/modules/product/entities/product-attribute-value.entity';
import { TransactionStatus } from '../src/modules/transaction/entities/transaction.entity';
import {
  cleanupCommerceFixture,
  createIsolatedCommerceFixture,
} from './helpers/commerce-fixtures';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ormconfig = require('../ormconfig.json');

describe('Commerce security integration (LOCAL DB, isolated fixtures)', () => {
  let connection: Connection;
  let productService: ProductService;
  let dbAvailable = false;
  let skipReason = '';

  beforeAll(async () => {
    if (
      ormconfig.host !== '127.0.0.1' ||
      ormconfig.database !== 'ragashop_local'
    ) {
      skipReason = 'Not configured for ragashop_local on 127.0.0.1';
      return;
    }

    try {
      connection = await createConnection({
        ...ormconfig,
        entities: [`${__dirname}/../src/**/*.entity{.ts,.js}`],
      });
      dbAvailable = true;

      productService = new ProductService(
        connection.getRepository(ProductEntity),
        connection.getRepository(ProductAttributeValueEntity),
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        new (require('../src/modules/product/product-child-mutation-lock.service').ProductChildMutationLockService)(
          connection,
        ),
      );
    } catch (err) {
      skipReason = err?.message || 'connection failed';
    }
  }, 60000);

  afterAll(async () => {
    if (connection?.isConnected) {
      await connection.close();
    }
  });

  function requireDb() {
    if (!dbAvailable) {
      throw new Error(`LOCAL DB unavailable: ${skipReason}`);
    }
  }

  it('atomic decrement prevents overselling on isolated product', async () => {
    requireDb();
    const fixture = await createIsolatedCommerceFixture(connection);

    try {
      await connection.query(`UPDATE product SET quantity = 2 WHERE id = ?`, [
        fixture.productId,
      ]);

      const queryRunner = connection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const first = await productService.decrementQuantity(
        fixture.productId,
        1,
        queryRunner,
      );
      const second = await productService.decrementQuantity(
        fixture.productId,
        1,
        queryRunner,
      );
      const third = await productService.decrementQuantity(
        fixture.productId,
        1,
        queryRunner,
      );

      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(third).toBe(false);

      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    } finally {
      await cleanupCommerceFixture(connection, fixture);
    }
  });

  it('referral_award unique constraint on isolated order fixture', async () => {
    requireDb();
    const fixture = await createIsolatedCommerceFixture(connection);

    try {
      const customerRows = await connection.query(
        `SELECT customerId FROM transaction WHERE id = ?`,
        [fixture.transactionId],
      );
      const customerId = customerRows[0].customerId;

      await connection.query(
        `INSERT INTO referral_award (orderId, referrerCustomerId, referredCustomerId, walletUSD, walletIRT, walletTRY, createdAt)
         VALUES (?, ?, ?, 0, 10, 0, NOW())`,
        [fixture.orderId, customerId, customerId],
      );

      await expect(
        connection.query(
          `INSERT INTO referral_award (orderId, referrerCustomerId, referredCustomerId, walletUSD, walletIRT, walletTRY, createdAt)
           VALUES (?, ?, ?, 0, 10, 0, NOW())`,
          [fixture.orderId, customerId, customerId],
        ),
      ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });

      await connection.query(`DELETE FROM referral_award WHERE orderId = ?`, [
        fixture.orderId,
      ]);
    } finally {
      await cleanupCommerceFixture(connection, fixture);
    }
  });

  it('paid transaction cannot be downgraded via reconcilable-only update', async () => {
    requireDb();
    const fixture = await createIsolatedCommerceFixture(connection);

    try {
      await connection.query(
        `UPDATE transaction SET status = 'paid' WHERE id = ?`,
        [fixture.transactionId],
      );

      await connection.query(
        `UPDATE transaction SET status = ?, message = ? WHERE id = ? AND status = ?`,
        [
          TransactionStatus.failed,
          'should-not-apply',
          fixture.transactionId,
          TransactionStatus.pending,
        ],
      );

      const reloaded = await connection.query(
        `SELECT status FROM transaction WHERE id = ?`,
        [fixture.transactionId],
      );
      expect(reloaded[0].status).toBe(TransactionStatus.paid);
    } finally {
      await cleanupCommerceFixture(connection, fixture);
    }
  });
});
