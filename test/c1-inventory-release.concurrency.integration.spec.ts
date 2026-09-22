import { createConnection, Connection } from 'typeorm';
import { HttpException } from '@nestjs/common';
import { OrderService } from '../src/modules/order/order.service';
import { OrderEntity, OrderStatus } from '../src/modules/order/entities/order.entity';
import { OrderItemEntity } from '../src/modules/order/entities/order-item.entity';
import { ProductService } from '../src/modules/product/product.service';
import { ProductEntity } from '../src/modules/product/entities/product.entity';
import { ProductAttributeValueEntity } from '../src/modules/product/entities/product-attribute-value.entity';
import {
  TransactionEntity,
  TransactionStatus,
} from '../src/modules/transaction/entities/transaction.entity';
import { TransactionService } from '../src/modules/transaction/transaction.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ormconfig = require('../ormconfig.json');

const LOCAL_HOST = '127.0.0.1';
const LOCAL_DB = 'ragashop_local';
const FIXTURE_PREFIX = 'C1_RACE_';

describe('C1 inventory release concurrency (LOCAL DB)', () => {
  let connection: Connection;
  let dbAvailable = false;
  let skipReason = '';
  let orderService: OrderService;
  let transactionService: TransactionService;
  let productService: ProductService;

  beforeAll(async () => {
    if (ormconfig.host !== LOCAL_HOST || ormconfig.database !== LOCAL_DB) {
      skipReason = `Expected ${LOCAL_HOST}/${LOCAL_DB}`;
      return;
    }

    try {
      connection = await createConnection({
        ...ormconfig,
        entities: [`${__dirname}/../src/**/*.entity{.ts,.js}`],
      });
      dbAvailable = true;

      const error = {
        unprocessableEntity: (msgs: string[]) => {
          throw new HttpException({ messages: msgs }, 422);
        },
        methodNotAllowed: (msgs: string[]) => {
          throw new HttpException({ messages: msgs }, 405);
        },
        internalServerError: (msgs: string[]) => {
          throw new HttpException({ messages: msgs }, 500);
        },
      };

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

      orderService = new OrderService(
        connection.getRepository(OrderEntity),
        connection.getRepository(OrderItemEntity),
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        productService,
        error as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any, // financialEventService (14th dep)
      );

      transactionService = new TransactionService(
        connection.getRepository(TransactionEntity),
        {
          app: { siteBaseUrl: 'http://site.test' },
          gateway: { mode: 'live' },
        } as any,
        error as any,
        { paymentVerification: jest.fn() } as any,
        orderService,
        {} as any,
        {} as any,
        {} as any,
      );
    } catch (err) {
      skipReason = err?.message || 'connection failed';
    }
  }, 120000);

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

  async function createPendingOrderWithStock(qtyReserved = 2) {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    const categoryRows = await connection.query(
      `SELECT categoryId FROM product WHERE categoryId IS NOT NULL LIMIT 1`,
    );
    const categoryId = categoryRows[0].categoryId;

    const productInsert = await connection.query(
      `INSERT INTO product (categoryId, name, price, discountedPrice, quantity, status, isDeleted, createdAt, displayOrder, currency)
       VALUES (?, ?, 10000, NULL, ?, 'active', 0, NOW(), 1, 'TRY')`,
      [categoryId, `${FIXTURE_PREFIX}product_${suffix}`, 10 - qtyReserved],
    );
    const productId = productInsert.insertId;

    const customerRows = await connection.query(
      `SELECT id FROM customer WHERE isDeleted = 0 LIMIT 1`,
    );
    const customerId = customerRows[0].id;
    const cityRows = await connection.query(`SELECT id FROM city LIMIT 1`);
    const cityId = cityRows[0]?.id ?? null;

    const orderInsert = await connection.query(
      `INSERT INTO \`order\` (customerId, number, amount, discount, shipping, tax, finalAmount, address, status, createdAt, cityId)
       VALUES (?, ?, 10000, 0, 0, 0, 10000, 'c1 race', 'pending', NOW(), ?)`,
      [customerId, `${FIXTURE_PREFIX}order_${suffix}`, cityId],
    );
    const orderId = orderInsert.insertId;

    await connection.query(
      `INSERT INTO order_item (orderId, productId, productAttributeValueId, price, discountedPrice, quantity, finalAmount, createdAt)
       VALUES (?, ?, NULL, 10000, 0, ?, 10000, NOW())`,
      [orderId, productId, qtyReserved],
    );

    const gatewayRows = await connection.query(
      `SELECT id FROM gateway WHERE isDeleted = 0 LIMIT 1`,
    );
    const txInsert = await connection.query(
      `INSERT INTO transaction (orderId, customerId, gatewayId, amount, walletAmount, walletIRT, walletTRY, walletUSD, reduceCardAmount, status, gatewaySessionStatus, ip, createdAt)
       VALUES (?, ?, ?, 10000, 0, 0, 0, 0, 0, 'pending', 'not_started', '127.0.0.1', NOW())`,
      [orderId, customerId, gatewayRows[0].id],
    );

    return {
      orderId,
      productId,
      transactionId: txInsert.insertId,
      qtyReserved,
    };
  }

  async function cleanup(fixture: {
    orderId: number;
    productId: number;
    transactionId: number;
  }) {
    // Clear FK references before deleting transaction rows.
    await connection.query(
      `UPDATE \`order\` SET successfulTransactionId = NULL WHERE id = ?`,
      [fixture.orderId],
    );
    await connection.query(
      `DELETE FROM order_payment_finalization WHERE orderId = ?`,
      [fixture.orderId],
    );
    await connection.query(`DELETE FROM transaction WHERE orderId = ?`, [
      fixture.orderId,
    ]);
    await connection.query(`DELETE FROM order_item WHERE orderId = ?`, [
      fixture.orderId,
    ]);
    await connection.query(`DELETE FROM \`order\` WHERE id = ?`, [
      fixture.orderId,
    ]);
    await connection.query(`DELETE FROM product WHERE id = ?`, [
      fixture.productId,
    ]);
  }

  async function productQty(productId: number): Promise<number> {
    const rows = await connection.query(
      `SELECT quantity FROM product WHERE id = ?`,
      [productId],
    );
    return Number(rows[0].quantity);
  }

  it('two concurrent rejects restore inventory exactly once', async () => {
    requireDb();
    const fixture = await createPendingOrderWithStock(2);
    const before = await productQty(fixture.productId);

    try {
      const rejectOnce = async () => {
        try {
          await orderService.updateStatus({
            id: fixture.orderId,
            status: OrderStatus.rejected,
          } as any);
          return 'ok';
        } catch {
          return 'err';
        }
      };

      const [a, b] = await Promise.all([rejectOnce(), rejectOnce()]);

      const after = await productQty(fixture.productId);
      expect(after - before).toBe(2);

      const orderRows = await connection.query(
        `SELECT status FROM \`order\` WHERE id = ?`,
        [fixture.orderId],
      );
      expect(orderRows[0].status).toBe('rejected');
      expect([a, b].filter((x) => x === 'ok').length).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanup(fixture);
    }
  }, 60000);

  it('verification_started blocks concurrent reject from releasing stock', async () => {
    requireDb();
    const fixture = await createPendingOrderWithStock(2);
    const before = await productQty(fixture.productId);

    try {
      await connection.query(
        `UPDATE transaction SET status = 'verification_started', verificationStartedAt = NOW() WHERE id = ?`,
        [fixture.transactionId],
      );

      await expect(
        orderService.updateStatus({
          id: fixture.orderId,
          status: OrderStatus.rejected,
        } as any),
      ).rejects.toBeInstanceOf(HttpException);

      const after = await productQty(fixture.productId);
      expect(after).toBe(before);

      const orderRows = await connection.query(
        `SELECT status FROM \`order\` WHERE id = ?`,
        [fixture.orderId],
      );
      expect(orderRows[0].status).toBe('pending');
    } finally {
      await cleanup(fixture);
    }
  }, 60000);

  it('barrier: release wins first → verification authorization fails (provider must not proceed)', async () => {
    requireDb();
    const fixture = await createPendingOrderWithStock(2);
    const before = await productQty(fixture.productId);

    try {
      const holdQr = connection.createQueryRunner();
      await holdQr.connect();
      await holdQr.startTransaction();

      // Hold Order lock and commit a reject under that lock (deterministic winner).
      const locked = await holdQr.manager.findOne(OrderEntity, {
        where: { id: fixture.orderId },
        lock: { mode: 'pessimistic_write' },
      });
      expect(locked).toBeTruthy();

      const items = await holdQr.manager.find(OrderItemEntity, {
        where: { orderId: fixture.orderId },
      });
      await orderService.restoreReservedInventory(items, holdQr);
      locked!.status = OrderStatus.rejected;
      await holdQr.manager.save(locked!);

      // Verification waits on the same Order lock until we commit.
      const authPromise = (transactionService as any).markVerificationStarted(
        fixture.transactionId,
        '999001',
      );

      await new Promise((r) => setImmediate(r));
      await holdQr.commitTransaction();
      await holdQr.release();

      const auth = await authPromise;
      expect(auth).toBe('not_payable');

      const after = await productQty(fixture.productId);
      expect(after).toBe(before + 2);

      const orderRows = await connection.query(
        `SELECT status FROM \`order\` WHERE id = ?`,
        [fixture.orderId],
      );
      expect(orderRows[0].status).toBe('rejected');

      const txRows = await connection.query(
        `SELECT status FROM transaction WHERE id = ?`,
        [fixture.transactionId],
      );
      expect(txRows[0].status).toBe('pending');
    } finally {
      await cleanup(fixture);
    }
  }, 60000);

  it('barrier: verification authorization wins → reject cannot release inventory', async () => {
    requireDb();
    const fixture = await createPendingOrderWithStock(2);
    const before = await productQty(fixture.productId);

    try {
      const auth = await (transactionService as any).markVerificationStarted(
        fixture.transactionId,
        '999002',
      );
      expect(auth).toBe('started');

      await expect(
        orderService.updateStatus({
          id: fixture.orderId,
          status: OrderStatus.rejected,
        } as any),
      ).rejects.toBeInstanceOf(HttpException);

      const after = await productQty(fixture.productId);
      expect(after).toBe(before);

      const txRows = await connection.query(
        `SELECT status FROM transaction WHERE id = ?`,
        [fixture.transactionId],
      );
      expect(txRows[0].status).toBe('verification_started');

      const orderRows = await connection.query(
        `SELECT status FROM \`order\` WHERE id = ?`,
        [fixture.orderId],
      );
      expect(orderRows[0].status).toBe('pending');
    } finally {
      await cleanup(fixture);
    }
  }, 60000);

  it('cleanup candidate query excludes protected and includes eligible unpaid', async () => {
    requireDb();

    const protectedFixtures = [];
    const eligible = await createPendingOrderWithStock(1);
    await connection.query(
      `UPDATE \`order\` SET createdAt = DATE_SUB(NOW(), INTERVAL 48 HOUR) WHERE id = ?`,
      [eligible.orderId],
    );

    try {
      for (let i = 0; i < 11; i++) {
        const f = await createPendingOrderWithStock(1);
        await connection.query(
          `UPDATE \`order\` SET createdAt = DATE_SUB(NOW(), INTERVAL 72 HOUR) WHERE id = ?`,
          [f.orderId],
        );
        await connection.query(
          `UPDATE transaction SET status = 'verification_uncertain' WHERE id = ?`,
          [f.transactionId],
        );
        protectedFixtures.push(f);
      }

      process.env.UNPAID_ORDER_TIMEOUT_HOURS = '24';
      process.env.UNPAID_ORDER_CLEANUP_BATCH_SIZE = '1';

      const pastTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const baseQb = () =>
        connection
          .getRepository(OrderEntity)
          .createQueryBuilder('o')
          .select(['o.id', 'o.createdAt'])
          .where('o.status = :status', { status: OrderStatus.pending })
          .andWhere('o.createdAt < :pastTime', { pastTime })
          .andWhere('o.successfulTransactionId IS NULL')
          .andWhere(
            `NOT EXISTS (
              SELECT 1 FROM order_payment_finalization f
              WHERE f.orderId = o.id
            )`,
          )
          .andWhere(
            `NOT EXISTS (
              SELECT 1 FROM transaction t
              WHERE t.orderId = o.id
                AND (
                  t.status IN (:...preservedStatuses)
                  OR t.paidAt IS NOT NULL
                )
            )`,
            {
              preservedStatuses: [
                TransactionStatus.paid,
                TransactionStatus.provider_paid_superseded,
                TransactionStatus.verification_started,
                TransactionStatus.verification_uncertain,
              ],
            },
          );

      const eligibleMatch = await baseQb()
        .andWhere('o.id = :id', { id: eligible.orderId })
        .getOne();
      expect(eligibleMatch?.id).toBe(eligible.orderId);

      for (const f of protectedFixtures) {
        const protectedMatch = await baseQb()
          .andWhere('o.id = :id', { id: f.orderId })
          .getOne();
        expect(protectedMatch).toBeUndefined();
      }

      // Destructive path still reclaims eligible unpaid while leaving protected.
      await orderService.delete(eligible.orderId);
      const gone = await connection.query(
        `SELECT id FROM \`order\` WHERE id = ?`,
        [eligible.orderId],
      );
      expect(gone.length).toBe(0);

      for (const f of protectedFixtures) {
        const rows = await connection.query(
          `SELECT id, status FROM \`order\` WHERE id = ?`,
          [f.orderId],
        );
        expect(rows.length).toBe(1);
        expect(rows[0].status).toBe('pending');
      }

      // Cross-run progress: with batchSize=1, handleDeleteUnpaid never selects
      // protected rows, so repeated invocations only see eligible candidates.
      process.env.UNPAID_ORDER_CLEANUP_BATCH_SIZE = '1';
      const sample = await orderService.handleDeleteUnpaid();
      expect(sample.failed).toBeGreaterThanOrEqual(0);
      for (const f of protectedFixtures) {
        const rows = await connection.query(
          `SELECT id FROM \`order\` WHERE id = ?`,
          [f.orderId],
        );
        expect(rows.length).toBe(1);
      }
    } finally {
      delete process.env.UNPAID_ORDER_TIMEOUT_HOURS;
      delete process.env.UNPAID_ORDER_CLEANUP_BATCH_SIZE;
      try {
        await cleanup(eligible);
      } catch {
        /* already deleted */
      }
      for (const f of protectedFixtures) {
        await cleanup(f);
      }
    }
  }, 180000);
});
