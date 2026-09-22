import { createConnection, Connection } from 'typeorm';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProductService } from '../src/modules/product/product.service';
import { ProductChildMutationLockService } from '../src/modules/product/product-child-mutation-lock.service';
import {
  ProductEntity,
  ProductStatus,
} from '../src/modules/product/entities/product.entity';
import { ProductAttributeValueEntity } from '../src/modules/product/entities/product-attribute-value.entity';
import { ProductDescriptionEntity } from '../src/modules/product/entities/product-description.entity';
import {
  ProductGalleryEntity,
  ProductGalleryType,
} from '../src/modules/product/entities/product-gallery.entity';
import { ErrorService } from '../src/error/error.service';
import { UserEntity } from '../src/modules/user/entities/user.entity';
import { ProductService as CrawlerProductService } from '../../ragashop-crawler/src/product/product.service';
import { ProductEntity as CrawlerProductEntity } from '../../ragashop-crawler/src/product/entities/product.entity';
import { ProductChildMutationLockService as CrawlerChildLockService } from '../../ragashop-crawler/src/product/product-child-mutation-lock.service';
import { FavoriteService } from '../src/modules/favorite/favorite.service';
import { FavoriteLockService } from '../src/modules/favorite/favorite-lock.service';
import { ProductFavoriteEntity } from '../src/modules/favorite/entities/product-favorite.entity';
import { CustomerEntity } from '../src/modules/customer/entities/customer.entity';
import { RaceBarrier } from './helpers/race-barrier';
import {
  assertDeletedProductRaceInvariants,
  closeAllTypeOrmConnections,
  snapshotChildBaseline,
} from './helpers/lifecycle-race.util';

jest.mock('../src/utils/sharp', () => ({
  generateThumbnail: jest.fn().mockResolvedValue(undefined),
  optimizeImage: jest.fn().mockResolvedValue(undefined),
  applyPathToThumbPath: (p: string) => p.replace(/(\.[^.]+)$/, '_thumb$1'),
}));

const LOCAL_HOST = '127.0.0.1';
const LOCAL_DB = 'ragashop_local';

function buildApiProductService(connection: Connection, attributeValueId = 2) {
  const error = {
    unprocessableEntity: (m: string[]) => {
      throw new Error(m[0]);
    },
    methodNotAllowed: (m: string[]) => {
      throw new Error(m[0]);
    },
  } as unknown as ErrorService;

  return new ProductService(
    connection.getRepository(ProductEntity),
    connection.getRepository(ProductAttributeValueEntity),
    connection.getRepository(ProductDescriptionEntity),
    connection.getRepository(ProductGalleryEntity),
    {} as any,
    error,
    {
      getRecordById: jest.fn().mockResolvedValue({ id: attributeValueId }),
    } as any,
    { getRecordById: jest.fn().mockResolvedValue({ id: 2 }) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    new ProductChildMutationLockService(connection),
  );
}

function buildFavoriteService(connection: Connection) {
  const error = {
    unprocessableEntity: (m: string[]) => {
      throw new Error(m[0]);
    },
  } as unknown as ErrorService;

  return new FavoriteService(
    connection.getRepository(ProductFavoriteEntity),
    connection.getRepository(ProductEntity),
    error,
    new FavoriteLockService(connection),
    new ProductChildMutationLockService(connection),
  );
}

function pauseProductLockAtBarrier(
  lockService: ProductChildMutationLockService,
  productId: number,
  barrier: RaceBarrier,
  writerGate: { armed: boolean },
) {
  const original = lockService.withProductChildLock.bind(lockService);
  return jest
    .spyOn(lockService, 'withProductChildLock')
    .mockImplementation(async (pid, fn) => {
      if (pid === productId && writerGate.armed) {
        writerGate.armed = false;
        return barrier.pauseAtBarrier(() => original(pid, fn));
      }
      return original(pid, fn);
    });
}

describe('Product lifecycle race integration (LOCAL DB)', () => {
  let connection: Connection;
  let crawlerConnection: Connection;
  let dbAvailable = false;
  let skipReason = '';
  let productService: ProductService;
  let favoriteService: FavoriteService;
  let crawlerProductService: CrawlerProductService;
  let productId: number;
  let attributeValueId: number;
  let customerId: number;
  const user = { id: 1 } as UserEntity;
  const createdProductIds: number[] = [];
  const createdCustomerIds: number[] = [];

  beforeAll(async () => {
    try {
      connection = await createConnection({
        name: 'api-lifecycle-race',
        type: 'mysql',
        host: LOCAL_HOST,
        port: 3306,
        username: 'root',
        password: '',
        database: LOCAL_DB,
        entities: [`${__dirname}/../src/**/*.entity{.ts,.js}`],
      });
      crawlerConnection = await createConnection({
        name: 'crawler-lifecycle-race',
        type: 'mysql',
        host: LOCAL_HOST,
        port: 3306,
        username: 'root',
        password: '',
        database: LOCAL_DB,
        entities: [
          `${__dirname}/../../ragashop-crawler/src/**/*.entity{.ts,.js}`,
        ],
      });

      const avRow = await connection.query(
        'SELECT id FROM attribute_value LIMIT 1',
      );
      attributeValueId = avRow?.[0]?.id;
      productService = buildApiProductService(connection, attributeValueId);
      favoriteService = buildFavoriteService(connection);

      crawlerProductService = new CrawlerProductService(
        crawlerConnection.getRepository(CrawlerProductEntity),
        crawlerConnection.getRepository('ProductAttributeValueEntity') as any,
        crawlerConnection.getRepository('ProductDescriptionEntity') as any,
        crawlerConnection.getRepository('ProductGalleryEntity') as any,
        {} as any,
        {} as any,
        {} as any,
        { getProductById: jest.fn() } as any,
        {
          text: jest.fn().mockResolvedValue('translated'),
          color: jest.fn().mockResolvedValue(null),
          array: jest.fn().mockResolvedValue(['desc']),
        } as any,
        {} as any,
        {} as any,
        new CrawlerChildLockService(crawlerConnection),
      );
      jest
        .spyOn(crawlerProductService as any, '_findOrTranslateProduct')
        .mockResolvedValue('name');
      jest
        .spyOn(crawlerProductService as any, '_translateColor')
        .mockResolvedValue({ color: 'red', colorHex: '#ff0000' });
      jest
        .spyOn(crawlerProductService as any, '_findOrTranslateDescriptions')
        .mockResolvedValue(['crawler translated']);
      (crawlerProductService as any).brandService = {
        addOrUpdate: jest.fn().mockResolvedValue(1),
      };
      (crawlerProductService as any).categoryService = {
        addOrUpdate: jest.fn().mockResolvedValue(2),
      };
      (crawlerProductService as any).attributeService = {
        addOrUpdates: jest.fn().mockResolvedValue([]),
      };

      dbAvailable = true;
    } catch (err) {
      skipReason = err?.message || 'connection failed';
      dbAvailable = false;
    }
  }, 120000);

  afterAll(async () => {
    for (const conn of [connection, crawlerConnection]) {
      if (!conn?.isConnected) continue;
      for (const id of createdProductIds) {
        await conn.query('DELETE FROM product_favorite WHERE productId = ?', [
          id,
        ]);
        await conn.query(
          `DELETE FROM product_gallery WHERE productId = ? OR pathFile LIKE ?`,
          [id, `%lifecycle-race-${id}%`],
        );
        await conn.query(
          'DELETE FROM product_description WHERE productId = ?',
          [id],
        );
        await conn.query(
          'DELETE FROM product_attribute_value WHERE productId = ?',
          [id],
        );
        await conn.query('DELETE FROM product WHERE id = ?', [id]);
      }
      for (const id of createdCustomerIds) {
        await conn.query('DELETE FROM customer WHERE id = ?', [id]);
      }
    }
    await closeAllTypeOrmConnections();
  });

  async function createActiveProduct(label: string) {
    const insert = await connection.query(
      `INSERT INTO product (categoryId, name, price, discountedPrice, quantity, status, isDeleted, createdAt, displayOrder, currency, source, sourceId)
       VALUES (2, ?, 100, NULL, 5, 'active', 0, NOW(), 1, 'TRY', 'trendyol', ?)`,
      [`${label} ${Date.now()}`, `race-${Date.now()}`],
    );
    const id = insert.insertId as number;
    createdProductIds.push(id);
    return id;
  }

  async function createCustomer() {
    const insert = await connection.query(
      `INSERT INTO customer (mobile, status, isDeleted, createdAt, walletUSD, walletIRT, walletTRY)
       VALUES (?, 'active', 0, NOW(), 0, 0, 0)`,
      [`+98912${Date.now().toString().slice(-7)}`],
    );
    const id = insert.insertId as number;
    createdCustomerIds.push(id);
    return connection.getRepository(CustomerEntity).findOne(id);
  }

  function requireDb() {
    if (!dbAvailable) throw new Error(`LOCAL DB unavailable: ${skipReason}`);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('delete wins vs PAV writer — mutation rejected, no new active PAV', async () => {
    requireDb();
    productId = await createActiveProduct('DelPAV');
    await connection.query(
      `INSERT INTO product_attribute_value (productId, attributeValueId, quantity, isDeleted, price)
       VALUES (?, ?, 5, 0, 100)`,
      [productId, attributeValueId],
    );
    const baseline = await snapshotChildBaseline(connection, productId);
    const barrier = new RaceBarrier();
    const writerGate = { armed: true };
    const lockService = (productService as any)
      .productChildMutationLockService as ProductChildMutationLockService;
    pauseProductLockAtBarrier(lockService, productId, barrier, writerGate);

    const pavPromise = productService
      .addUpdateProductAttributeValue({
        productId,
        attributeValueId,
        quantity: 99,
        price: 200,
        discountedPrice: 180,
      } as any)
      .catch(() => null);

    await barrier.waitUntilReached(15000, 'PAV');
    const deletePromise = productService.delete(productId, user);
    barrier.release();
    await Promise.all([pavPromise, deletePromise]);

    await assertDeletedProductRaceInvariants(connection, productId, baseline);
  });

  it('delete wins vs Gallery add — no new attached Gallery', async () => {
    requireDb();
    productId = await createActiveProduct('DelGalleryA');
    const baseline = await snapshotChildBaseline(connection, productId);
    const pathFile = `/products/lifecycle-race-${productId}.jpg`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragashop-race-'));
    const tempFile = path.join(tempDir, `lifecycle-race-${productId}.jpg`);
    fs.writeFileSync(tempFile, 'fake');

    const barrier = new RaceBarrier();
    const writerGate = { armed: true };
    const lockService = (productService as any)
      .productChildMutationLockService as ProductChildMutationLockService;
    pauseProductLockAtBarrier(lockService, productId, barrier, writerGate);

    const galleryPromise = productService
      .addGallery(
        { productId, isCover: false } as any,
        { filename: `lifecycle-race-${productId}.jpg`, path: tempFile } as any,
        ProductGalleryType.photo,
        user,
      )
      .catch(() => null);

    await barrier.waitUntilReached(15000, 'Gallery-A');
    const deletePromise = productService.delete(productId, user);
    barrier.release();
    await Promise.all([galleryPromise, deletePromise]);

    await assertDeletedProductRaceInvariants(connection, productId, baseline);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('Gallery wins then delete — attached Gallery detached, Product deleted', async () => {
    requireDb();
    productId = await createActiveProduct('DelGalleryB');
    const baseline = await snapshotChildBaseline(connection, productId);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragashop-race-'));
    const tempFile = path.join(tempDir, `lifecycle-race-${productId}.jpg`);
    fs.writeFileSync(tempFile, 'fake');

    await productService.addGallery(
      { productId, isCover: false } as any,
      { filename: `lifecycle-race-${productId}.jpg`, path: tempFile } as any,
      ProductGalleryType.photo,
      user,
    );

    const afterGallery = await snapshotChildBaseline(connection, productId);
    expect(afterGallery.attachedGallery).toBe(baseline.attachedGallery + 1);

    await productService.delete(productId, user);

    await assertDeletedProductRaceInvariants(connection, productId, baseline);

    const detached = await connection.query(
      `SELECT id FROM product_gallery WHERE pathFile = ? AND productId = ?`,
      [`/products/lifecycle-race-${productId}.jpg`, productId],
    );
    expect(detached.length).toBe(0);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('delete wins vs admin Description — no new admin Description', async () => {
    requireDb();
    productId = await createActiveProduct('DelDesc');
    await connection.query(
      `INSERT INTO product_description (productId, source, sourceContent, content, displayOrder, isDeleted)
       VALUES (?, 'trendyol', 'block', 'crawler', 1, 0), (?, NULL, NULL, 'manual', 2, 0)`,
      [productId, productId],
    );
    const baseline = await snapshotChildBaseline(connection, productId);

    const barrier = new RaceBarrier();
    const originalUpdate = productService.update.bind(productService);
    jest
      .spyOn(productService, 'update')
      .mockImplementation(async (...args) =>
        barrier.pauseAtBarrier(() => originalUpdate(...args)),
      );

    const descPromise = productService
      .update(
        {
          id: productId,
          categoryId: 2,
          descriptions: [{ content: 'manual race update' }],
        } as any,
        user,
      )
      .catch(() => null);

    await barrier.waitUntilReached(15000, 'Description');
    await productService.delete(productId, user);
    barrier.release();
    await descPromise;

    await assertDeletedProductRaceInvariants(connection, productId, baseline);
  });

  it('delete wins vs stale Product update — guarded write does not persist', async () => {
    requireDb();
    productId = await createActiveProduct('UpdDel');
    const baseline = await snapshotChildBaseline(connection, productId);
    const barrier = new RaceBarrier();
    const originalUpdate = productService.update.bind(productService);
    jest
      .spyOn(productService, 'update')
      .mockImplementation(async (...args) =>
        barrier.pauseAtBarrier(() => originalUpdate(...args)),
      );

    const updatePromise = productService
      .update(
        {
          id: productId,
          categoryId: 2,
          status: ProductStatus.active,
          name: 'should-not-stick',
        } as any,
        user,
      )
      .catch(() => null);

    await barrier.waitUntilReached(15000, 'Update');
    await productService.delete(productId, user);
    barrier.release();
    await updatePromise;

    await assertDeletedProductRaceInvariants(connection, productId, baseline);
    const product = await connection
      .getRepository(ProductEntity)
      .findOne(productId);
    expect(product!.name).not.toBe('should-not-stick');
  });

  it('delete wins vs Favorite add — no active Favorite', async () => {
    requireDb();
    productId = await createActiveProduct('DelFav');
    const customer = await createCustomer();
    const baseline = await snapshotChildBaseline(connection, productId);
    const barrier = new RaceBarrier();
    const writerGate = { armed: true };
    const lockService = (favoriteService as any)
      .productChildMutationLockService as ProductChildMutationLockService;
    pauseProductLockAtBarrier(lockService, productId, barrier, writerGate);

    const favPromise = favoriteService
      .addDeleteProduct(productId, customer!)
      .catch(() => null);

    await barrier.waitUntilReached(15000, 'Favorite');
    const deletePromise = productService.delete(productId, user);
    barrier.release();
    await Promise.all([favPromise, deletePromise]);

    await assertDeletedProductRaceInvariants(connection, productId, baseline);
  });

  it('group activation excludes deleted Products', async () => {
    requireDb();
    const activeId = await createActiveProduct('GroupActive');
    const deletedId = await createActiveProduct('GroupDeleted');
    await connection.query(
      `UPDATE product SET isDeleted = 1, status = 'inactive' WHERE id = ?`,
      [deletedId],
    );

    await productService.groupUpdate({
      ids: [activeId, deletedId],
      status: ProductStatus.active,
    } as any);

    const active = await connection
      .getRepository(ProductEntity)
      .findOne(activeId);
    const deleted = await connection
      .getRepository(ProductEntity)
      .findOne(deletedId);
    expect(active!.status).toBe(ProductStatus.active);
    expect(deleted!.isDeleted).toBe(true);
    expect(deleted!.status).not.toBe(ProductStatus.active);
  });

  it('crawler applyCrawlerEnrichment vs API delete does not resurrect Product', async () => {
    requireDb();
    productId = await createActiveProduct('EnrichDel');
    const baseline = await snapshotChildBaseline(connection, productId);
    await connection.query(
      `UPDATE product SET source = 'trendyol', sourceId = ?, sourceUrl = '/p/x' WHERE id = ?`,
      [`enrich-api-${productId}`, productId],
    );
    const product = await connection
      .getRepository(ProductEntity)
      .findOne(productId);
    const barrier = new RaceBarrier();

    const originalApply = (
      crawlerProductService as any
    ).applyCrawlerEnrichment.bind(crawlerProductService);
    jest
      .spyOn(crawlerProductService as any, 'applyCrawlerEnrichment')
      .mockImplementation(async (...args: any[]) =>
        barrier.pauseAtBarrier(() => originalApply(...args)),
      );

    const enrichPromise = (crawlerProductService as any)
      .applyCrawlerEnrichment(product, {
        sourceId: product!.sourceId,
        sourceName: 'Full',
        sourceUrl: product!.sourceUrl,
        sourceGroupId: 'g',
        categoryId: 'c1',
        price: 100,
        discountedPrice: 90,
        currency: 'TRY',
        images: [],
        descriptions: [{ content: 'block', displayOrder: 1 }],
        attributes: [],
        isDeleted: false,
      })
      .catch(() => null);

    await barrier.waitUntilReached(15000, 'Enrichment');
    await productService.delete(productId, user);
    barrier.release();
    await enrichPromise;

    await assertDeletedProductRaceInvariants(connection, productId, baseline);
  });

  it('description cross-writer uses crawler child lock production path', async () => {
    requireDb();
    productId = await createActiveProduct('DescLock');
    await connection.query(
      `UPDATE product SET source = 'trendyol', sourceId = ?, sourceUrl = '/p/d' WHERE id = ?`,
      [`desc-lock-${productId}`, productId],
    );
    await connection.query(
      `INSERT INTO product_description (productId, source, sourceContent, content, displayOrder, isDeleted)
       VALUES (?, 'trendyol', 'block', 'crawler', 1, 0), (?, NULL, NULL, 'manual', 2, 0)`,
      [productId, productId],
    );
    const product = await connection
      .getRepository(ProductEntity)
      .findOne(productId);

    jest
      .spyOn(crawlerProductService as any, '_findOrTranslateDescriptions')
      .mockResolvedValue(['block']);
    jest
      .spyOn(crawlerProductService as any, '_findOrTranslateProduct')
      .mockResolvedValue('Full');

    await Promise.all([
      productService.update(
        {
          id: productId,
          categoryId: 2,
          descriptions: [{ content: 'manual updated' }],
        } as any,
        user,
      ),
      (crawlerProductService as any).applyCrawlerEnrichment(product, {
        sourceId: product!.sourceId,
        sourceName: 'Full',
        sourceUrl: product!.sourceUrl,
        images: [],
        descriptions: [{ content: 'block', displayOrder: 1 }],
        attributes: [],
        price: 50,
        discountedPrice: 45,
      }),
    ]);

    const rows = await connection.manager.find(ProductDescriptionEntity, {
      where: { productId, isDeleted: false },
    });
    expect(rows.find((r) => r.source == null)).toBeTruthy();
    expect(rows.filter((r) => r.source === 'trendyol').length).toBe(1);
  });
});
