import { createConnection, Connection } from 'typeorm';
import { FavoriteService } from '../src/modules/favorite/favorite.service';
import { FavoriteLockService } from '../src/modules/favorite/favorite-lock.service';
import { ProductFavoriteEntity } from '../src/modules/favorite/entities/product-favorite.entity';
import {
  ProductEntity,
  ProductStatus,
} from '../src/modules/product/entities/product.entity';
import {
  CustomerEntity,
  CustomerStatus,
} from '../src/modules/customer/entities/customer.entity';
import { ProductChildMutationLockService } from '../src/modules/product/product-child-mutation-lock.service';
import { ErrorService } from '../src/error/error.service';
import { closeAllTypeOrmConnections } from './helpers/lifecycle-race.util';

const LOCAL_HOST = '127.0.0.1';
const LOCAL_DB = 'ragashop_local';

describe('Favorite concurrency (LOCAL DB)', () => {
  let connection: Connection;
  let dbAvailable = false;
  let skipReason = '';
  const createdFavoriteIds: number[] = [];
  let customerId: number;
  let productId: number;

  beforeAll(async () => {
    try {
      connection = await createConnection({
        type: 'mysql',
        host: LOCAL_HOST,
        port: 3306,
        username: 'root',
        password: '',
        database: LOCAL_DB,
        entities: [`${__dirname}/../src/**/*.entity{.ts,.js}`],
      });
      const customerInsert = await connection.query(
        `INSERT INTO customer (mobile, status, isDeleted, createdAt, walletUSD, walletIRT, walletTRY)
         VALUES (?, 'active', 0, NOW(), 0, 0, 0)`,
        [`+98912${Date.now().toString().slice(-7)}`],
      );
      customerId = customerInsert.insertId;

      const productInsert = await connection.query(
        `INSERT INTO product (categoryId, name, price, discountedPrice, quantity, status, isDeleted, createdAt, displayOrder, currency)
         VALUES (2, ?, 100, NULL, -1, 'active', 0, NOW(), 1, 'TRY')`,
        [`FavTest ${Date.now()}`],
      );
      productId = productInsert.insertId;
      dbAvailable = true;
    } catch (err) {
      skipReason = err?.message || 'connection failed';
      dbAvailable = false;
    }
  }, 120000);

  afterAll(async () => {
    if (connection?.isConnected) {
      if (createdFavoriteIds.length) {
        await connection.query(
          `DELETE FROM product_favorite WHERE id IN (${createdFavoriteIds.join(
            ',',
          )})`,
        );
      }
      if (productId) {
        await connection.query(
          `DELETE FROM product_favorite WHERE productId = ${productId}`,
        );
        await connection.query(`DELETE FROM product WHERE id = ${productId}`);
      }
      if (customerId) {
        await connection.query(`DELETE FROM customer WHERE id = ${customerId}`);
      }
      await connection.close();
    }
    await closeAllTypeOrmConnections();
  });

  function requireDb() {
    if (!dbAvailable) throw new Error(`LOCAL DB unavailable: ${skipReason}`);
  }

  it('concurrent toggles from absent end absent with no active favorite', async () => {
    requireDb();
    const lockService = new FavoriteLockService(connection);
    const error = {
      unprocessableEntity: (m) => {
        throw new Error(m[0]);
      },
    } as unknown as ErrorService;
    const favoriteService = new FavoriteService(
      connection.getRepository(ProductFavoriteEntity),
      connection.getRepository(ProductEntity),
      error,
      lockService,
      new ProductChildMutationLockService(connection),
    );
    const customer = await connection
      .getRepository(CustomerEntity)
      .findOne(customerId);

    const [first, second] = await Promise.all([
      favoriteService.addDeleteProduct(productId, customer),
      favoriteService.addDeleteProduct(productId, customer),
    ]);

    expect(first).not.toBe(second);
    expect([first, second].sort()).toEqual([false, true]);

    const activeCount = await connection
      .getRepository(ProductFavoriteEntity)
      .count({
        where: { productId, customerId, isDeleted: false },
      });
    expect(activeCount).toBe(0);

    const rows = await connection.getRepository(ProductFavoriteEntity).find({
      where: { productId, customerId },
    });
    createdFavoriteIds.push(...rows.map((r) => r.id));
  });
});
