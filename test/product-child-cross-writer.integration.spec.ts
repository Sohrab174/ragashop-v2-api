import { createConnection, Connection } from 'typeorm';
import { ProductService } from '../src/modules/product/product.service';
import { ProductChildMutationLockService } from '../src/modules/product/product-child-mutation-lock.service';
import { ProductEntity } from '../src/modules/product/entities/product.entity';
import { ProductAttributeValueEntity } from '../src/modules/product/entities/product-attribute-value.entity';
import {
  ProductGalleryEntity,
  ProductGalleryType,
} from '../src/modules/product/entities/product-gallery.entity';
import { ProductDescriptionEntity } from '../src/modules/product/entities/product-description.entity';
import { ErrorService } from '../src/error/error.service';
import { productChildMutationLockName } from '../src/modules/product/product-child-mutation-lock.util';
import {
  syncGalleryRows,
  syncPavRows,
} from '../../ragashop-crawler/src/product/product-child-sync.service';
import { ProductChildMutationLockService as CrawlerChildLockService } from '../../ragashop-crawler/src/product/product-child-mutation-lock.service';
import { UserEntity } from '../src/modules/user/entities/user.entity';
import { closeAllTypeOrmConnections } from './helpers/lifecycle-race.util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../src/utils/sharp', () => ({
  generateThumbnail: jest.fn().mockResolvedValue(undefined),
  optimizeImage: jest.fn().mockResolvedValue(undefined),
  applyPathToThumbPath: (p: string) => p,
}));

const LOCAL_HOST = '127.0.0.1';
const LOCAL_DB = 'ragashop_local';

function buildProductService(connection: Connection, attributeValueId: number) {
  const error = {
    unprocessableEntity: (m: string[]) => {
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

describe('Actual API/crawler cross-writer concurrency (LOCAL DB)', () => {
  let apiConnection: Connection;
  let crawlerConnection: Connection;
  let dbAvailable = false;
  let skipReason = '';
  let productService: ProductService;
  let apiLockService: ProductChildMutationLockService;
  let crawlerLockService: CrawlerChildLockService;
  let productId: number;
  let attributeValueId: number;

  beforeAll(async () => {
    try {
      apiConnection = await createConnection({
        name: 'api-cross-writer',
        type: 'mysql',
        host: LOCAL_HOST,
        port: 3306,
        username: 'root',
        password: '',
        database: LOCAL_DB,
        entities: [`${__dirname}/../src/**/*.entity{.ts,.js}`],
      });
      crawlerConnection = await createConnection({
        name: 'crawler-cross-writer',
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

      apiLockService = new ProductChildMutationLockService(apiConnection);
      crawlerLockService = new CrawlerChildLockService(crawlerConnection);

      const avRow = await apiConnection.query(
        'SELECT id FROM attribute_value LIMIT 1',
      );
      attributeValueId = avRow?.[0]?.id;
      if (!attributeValueId) throw new Error('no attribute_value');

      productService = buildProductService(apiConnection, attributeValueId);

      const productInsert = await apiConnection.query(
        `INSERT INTO product (categoryId, name, price, discountedPrice, quantity, status, isDeleted, createdAt, displayOrder, currency)
         VALUES (2, ?, 100, NULL, -1, 'active', 0, NOW(), 1, 'TRY')`,
        [`CrossWriter ${Date.now()}`],
      );
      productId = productInsert.insertId;
      dbAvailable = true;
    } catch (err) {
      skipReason = err?.message || 'connection failed';
      dbAvailable = false;
    }
  }, 120000);

  afterAll(async () => {
    for (const connection of [apiConnection, crawlerConnection]) {
      if (connection?.isConnected) {
        await connection.query(
          `DELETE FROM product_gallery WHERE productId = ? OR (productId IS NULL AND pathFile LIKE '/products/real-cross-%')`,
          [productId],
        );
        await connection.query(
          'DELETE FROM product_attribute_value WHERE productId = ?',
          [productId],
        );
        await connection.query('DELETE FROM product WHERE id = ?', [productId]);
        await connection.close();
      }
    }
    await closeAllTypeOrmConnections();
  });

  function requireDb() {
    if (!dbAvailable) throw new Error(`LOCAL DB unavailable: ${skipReason}`);
  }

  it('uses identical lock name as crawler package', () => {
    const crawlerLockName =
      require('../../ragashop-crawler/src/product/product-child-mutation-lock.util').productChildMutationLockName(
        productId,
      );
    expect(productChildMutationLockName(productId)).toBe(crawlerLockName);
  });

  it('API PAV writer vs crawler syncPavRows converge to one active logical row', async () => {
    requireDb();
    const manager = crawlerConnection.manager;

    const crawlerInsert = async () =>
      crawlerLockService.withProductChildLock(productId, async () => {
        const existing = await manager.find(
          'ProductAttributeValueEntity' as any,
          {
            where: { productId },
          },
        );
        await syncPavRows(
          manager,
          productId,
          'trendyol',
          [
            {
              valueId: attributeValueId,
              price: 60,
              discountedPrice: 55,
              discountPercent: 8.33,
              quantity: -1,
            },
          ],
          existing as any,
        );
      });

    const [apiResult] = await Promise.all([
      productService.addUpdateProductAttributeValue({
        productId,
        attributeValueId,
        quantity: -1,
        price: 50,
        discountedPrice: 45,
      } as any),
      crawlerInsert(),
    ]);

    expect(apiResult.id).toBeTruthy();
    const activeCount = await apiConnection.query(
      `SELECT COUNT(*) AS cnt FROM product_attribute_value WHERE productId = ? AND attributeValueId = ? AND isDeleted = 0`,
      [productId, attributeValueId],
    );
    expect(Number(activeCount[0].cnt)).toBe(1);
    expect(apiLockService).toBeTruthy();
  });

  it('API addGallery vs crawler syncGalleryRows keep one normalized row', async () => {
    requireDb();
    const manager = crawlerConnection.manager;
    const pathFile = `/products/real-cross-${Date.now()}.jpg`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragashop-gallery-'));
    const tempFile = path.join(tempDir, path.basename(pathFile));
    fs.writeFileSync(tempFile, 'fake-image');

    const crawlerInsert = async () =>
      crawlerLockService.withProductChildLock(productId, async () => {
        const existing = await manager.find('ProductGalleryEntity' as any, {
          where: { productId },
        });
        await syncGalleryRows(
          manager,
          productId,
          'trendyol',
          [pathFile],
          null,
          existing as any,
        );
      });

    await Promise.all([
      productService.addGallery(
        { productId, isCover: false } as any,
        { filename: path.basename(pathFile), path: tempFile } as any,
        ProductGalleryType.photo,
        { id: 1 } as UserEntity,
      ),
      crawlerInsert(),
    ]);

    const rows = await apiConnection.query(
      `SELECT id FROM product_gallery WHERE productId = ? AND pathFile = ?`,
      [productId, pathFile],
    );
    expect(rows.length).toBe(1);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
