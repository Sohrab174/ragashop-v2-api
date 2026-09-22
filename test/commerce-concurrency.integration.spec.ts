import { createConnection, Connection } from 'typeorm';
import { ProductService } from '../src/modules/product/product.service';
import { ProductEntity } from '../src/modules/product/entities/product.entity';
import { ProductAttributeValueEntity } from '../src/modules/product/entities/product-attribute-value.entity';
import { GatewaySessionStatus } from '../src/modules/transaction/entities/transaction.entity';
import {
  cleanupCommerceFixture,
  createIsolatedCommerceFixture,
} from './helpers/commerce-fixtures';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ormconfig = require('../ormconfig.json');

const LOCAL_HOST = '127.0.0.1';
const LOCAL_DB = 'ragashop_local';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Commerce concurrency integration (LOCAL DB, isolated fixtures)', () => {
  let connection: Connection;
  let dbAvailable = false;
  let skipReason = '';
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

  it('concurrent stock decrement on isolated product allows one winner', async () => {
    requireDb();
    const fixture = await createIsolatedCommerceFixture(connection);

    try {
      await connection.query(`UPDATE product SET quantity = 1 WHERE id = ?`, [
        fixture.productId,
      ]);

      const attempt = async () => {
        const qr = connection.createQueryRunner();
        await qr.connect();
        await qr.startTransaction();
        const ok = await productService.decrementQuantity(
          fixture.productId,
          1,
          qr,
        );
        await sleep(40);
        if (ok) {
          await qr.commitTransaction();
        } else {
          await qr.rollbackTransaction();
        }
        await qr.release();
        return ok;
      };

      const results = await Promise.all([attempt(), attempt()]);
      expect(results.filter(Boolean).length).toBe(1);
    } finally {
      await cleanupCommerceFixture(connection, fixture);
    }
  });

  it('isolated finalization unique constraint allows one winner', async () => {
    requireDb();
    const fixture = await createIsolatedCommerceFixture(connection);

    try {
      const txBInsert = await connection.query(
        `INSERT INTO transaction (orderId, customerId, gatewayId, amount, walletAmount, walletIRT, walletTRY, walletUSD, reduceCardAmount, status, gatewaySessionStatus, ip, createdAt)
         SELECT orderId, customerId, gatewayId, amount, 0, 0, 0, 0, 0, 'pending', 'not_started', '127.0.0.1', NOW()
         FROM transaction WHERE id = ?`,
        [fixture.transactionId],
      );
      const txB = txBInsert.insertId;

      await connection.query(
        `INSERT INTO order_payment_finalization (orderId, transactionId, finalizedAt)
         VALUES (?, ?, NOW())`,
        [fixture.orderId, fixture.transactionId],
      );
      fixture.finalizationInserted = true;

      await expect(
        connection.query(
          `INSERT INTO order_payment_finalization (orderId, transactionId, finalizedAt)
           VALUES (?, ?, NOW())`,
          [fixture.orderId, txB],
        ),
      ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });

      await connection.query(`DELETE FROM transaction WHERE id = ?`, [txB]);
    } finally {
      await cleanupCommerceFixture(connection, fixture);
    }
  });

  it('concurrent gateway session status allows only one creator', async () => {
    requireDb();
    const fixture = await createIsolatedCommerceFixture(connection);
    let creatingCount = 0;

    try {
      const lockAndMark = async () => {
        const qr = connection.createQueryRunner();
        await qr.connect();
        await qr.startTransaction();
        const tx = await qr.manager.query(
          `SELECT id, gatewaySessionStatus FROM transaction WHERE id = ? FOR UPDATE`,
          [fixture.transactionId],
        );

        if (tx[0].gatewaySessionStatus === GatewaySessionStatus.not_started) {
          creatingCount += 1;
          await qr.manager.query(
            `UPDATE transaction SET gatewaySessionStatus = ? WHERE id = ?`,
            [GatewaySessionStatus.creating, fixture.transactionId],
          );
          await sleep(60);
          await qr.manager.query(
            `UPDATE transaction SET gatewaySessionStatus = ?, randomToken = ?, gatewayRedirectUrl = ? WHERE id = ?`,
            [
              GatewaySessionStatus.ready,
              `tok-${fixture.transactionId}`,
              `https://bank.test/${fixture.transactionId}`,
              fixture.transactionId,
            ],
          );
        }
        await qr.commitTransaction();
        await qr.release();
      };

      await Promise.all([lockAndMark(), lockAndMark()]);
      expect(creatingCount).toBe(1);
    } finally {
      await cleanupCommerceFixture(connection, fixture);
    }
  });
});
