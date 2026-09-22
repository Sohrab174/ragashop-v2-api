import { createConnection, Connection, Repository } from 'typeorm';
import { MarketplaceProductImportIdentityEntity } from '../../ragashop-crawler/src/marketplace-import/entities/marketplace-product-import-identity.entity';
import { MarketplaceProductImportIdentityService } from '../../ragashop-crawler/src/marketplace-import/marketplace-product-import-identity.service';
import {
  ProductEntity as CrawlerProductEntity,
  ProductCurrency,
} from '../../ragashop-crawler/src/product/entities/product.entity';
import { ProductService as CrawlerProductService } from '../../ragashop-crawler/src/product/product.service';
import { ProductChildMutationLockService as CrawlerChildLockService } from '../../ragashop-crawler/src/product/product-child-mutation-lock.service';
import { ProductService } from '../src/modules/product/product.service';
import { ProductChildMutationLockService } from '../src/modules/product/product-child-mutation-lock.service';
import { ProductAttributeValueEntity } from '../src/modules/product/entities/product-attribute-value.entity';
import { ProductDescriptionEntity } from '../src/modules/product/entities/product-description.entity';
import { ProductGalleryEntity } from '../src/modules/product/entities/product-gallery.entity';
import { ProductEntity } from '../src/modules/product/entities/product.entity';
import { ErrorService } from '../src/error/error.service';
import { UserEntity } from '../src/modules/user/entities/user.entity';
import { closeAllTypeOrmConnections } from './helpers/lifecycle-race.util';
import { RaceBarrier } from './helpers/race-barrier';

const LOCAL_HOST = '127.0.0.1';
const LOCAL_DB = 'ragashop_local';

describe('Enrichment vs API Product deletion concurrency (LOCAL DB)', () => {
  let crawlerConnection: Connection;
  let apiConnection: Connection;
  let dbAvailable = false;
  let skipReason = '';
  let identityService: MarketplaceProductImportIdentityService;
  let crawlerProductService: CrawlerProductService;
  let apiProductService: ProductService;
  let crawlerChildLock: CrawlerChildLockService;
  let productRepository: Repository<CrawlerProductEntity>;
  let crawlerGetProductById: jest.Mock;
  const createdIdentityKeys: string[] = [];
  const createdProductIds: number[] = [];
  const user = { id: 1 } as UserEntity;

  beforeAll(async () => {
    try {
      apiConnection = await createConnection({
        type: 'mysql',
        host: LOCAL_HOST,
        port: 3306,
        username: 'root',
        password: '',
        database: LOCAL_DB,
        entities: [`${__dirname}/../src/**/*.entity{.ts,.js}`],
      });
      crawlerConnection = await createConnection({
        name: 'crawler-enrich-del-api',
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

      productRepository = crawlerConnection.getRepository(CrawlerProductEntity);
      identityService = new MarketplaceProductImportIdentityService(
        crawlerConnection.getRepository(MarketplaceProductImportIdentityEntity),
        productRepository,
        crawlerConnection,
      );
      crawlerChildLock = new CrawlerChildLockService(crawlerConnection);

      const error = {
        unprocessableEntity: (m: string[]) => {
          throw new Error(m[0]);
        },
      } as unknown as ErrorService;

      apiProductService = new ProductService(
        apiConnection.getRepository(ProductEntity),
        apiConnection.getRepository(ProductAttributeValueEntity),
        apiConnection.getRepository(ProductDescriptionEntity),
        apiConnection.getRepository(ProductGalleryEntity),
        {} as any,
        error,
        {} as any,
        { getRecordById: jest.fn().mockResolvedValue({ id: 2 }) } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        new ProductChildMutationLockService(apiConnection),
      );

      crawlerGetProductById = jest.fn();
      crawlerProductService = new CrawlerProductService(
        productRepository,
        crawlerConnection.getRepository('ProductAttributeValueEntity') as any,
        crawlerConnection.getRepository('ProductDescriptionEntity') as any,
        crawlerConnection.getRepository('ProductGalleryEntity') as any,
        {} as any,
        {} as any,
        {} as any,
        { getProductById: crawlerGetProductById } as any,
        {
          text: jest.fn().mockResolvedValue('name'),
          color: jest.fn().mockResolvedValue(null),
          array: jest.fn().mockResolvedValue(['desc']),
        } as any,
        {} as any,
        identityService,
        crawlerChildLock,
      );

      jest
        .spyOn(crawlerProductService as any, '_findOrTranslateProduct')
        .mockResolvedValue('name');
      jest
        .spyOn(crawlerProductService as any, '_translateColor')
        .mockResolvedValue({ color: 'red', colorHex: '#ff0000' });
      jest
        .spyOn(crawlerProductService as any, '_findOrTranslateDescriptions')
        .mockResolvedValue(['desc']);
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
    for (const connection of [apiConnection, crawlerConnection]) {
      if (!connection?.isConnected) continue;
      if (createdProductIds.length) {
        const ids = createdProductIds.join(',');
        await connection.query(
          `DELETE FROM product_favorite WHERE productId IN (${ids})`,
        );
        await connection.query(
          `DELETE FROM product_gallery WHERE productId IN (${ids})`,
        );
        await connection.query(
          `DELETE FROM product_description WHERE productId IN (${ids})`,
        );
        await connection.query(
          `DELETE FROM product_attribute_value WHERE productId IN (${ids})`,
        );
        await connection.query(`DELETE FROM product WHERE id IN (${ids})`);
      }
      if (createdIdentityKeys.length) {
        const keys = createdIdentityKeys
          .map((k) => `'${k.replace(/'/g, "''")}'`)
          .join(',');
        await connection.query(
          `DELETE FROM marketplace_product_import_identity WHERE identityKey IN (${keys})`,
        );
      }
      await connection.close();
    }
    await closeAllTypeOrmConnections();
  });

  function requireDb() {
    if (!dbAvailable) throw new Error(`LOCAL DB unavailable: ${skipReason}`);
  }

  it('does not resurrect deleted Product when API delete races crawler enrichment', async () => {
    requireDb();
    const sourceProductId = `enrich-api-del-${Date.now()}`;
    const identityKey = `trendyol:${sourceProductId}`;
    createdIdentityKeys.push(identityKey);

    const begin = await identityService.beginImport(
      'trendyol',
      sourceProductId,
      {
        purpose: 'stub_create',
      },
    );
    if (begin.kind !== 'acquired' && begin.kind !== 'reclaimed') {
      throw new Error(`unexpected begin kind ${begin.kind}`);
    }

    await (crawlerProductService as any).persistStubProduct(
      {
        source: 'trendyol',
        sourceId: sourceProductId,
        sourceName: 'Stub',
        sourceUrl: `/p/${sourceProductId}`,
        sourceGroupId: 'g',
        price: 50,
        discountedPrice: 45,
        currency: ProductCurrency.TRY,
        coverPath: '/c.jpg',
      },
      { identityKey: begin.identityKey, ownerToken: begin.ownerToken },
    );

    const productId = await identityService.getIdentityProductId(
      'trendyol',
      sourceProductId,
    );
    createdProductIds.push(productId as number);

    await crawlerConnection.query(
      `UPDATE product SET categoryId = 2, isDeleted = 0, status = 'active' WHERE id = ?`,
      [productId],
    );
    await crawlerConnection.query(
      `UPDATE marketplace_product_import_identity
       SET status = 'succeeded', ownerToken = NULL, leaseExpiresAt = NULL, productId = ?
       WHERE identityKey = ?`,
      [productId, identityKey],
    );

    const product = await productRepository.findOne({
      where: { id: productId },
    });
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
        sourceId: sourceProductId,
        sourceName: 'Full',
        sourceUrl: `/p/${sourceProductId}`,
        sourceGroupId: 'g',
        categoryId: 'c1',
        price: 100,
        discountedPrice: 90,
        currency: ProductCurrency.TRY,
        images: [],
        descriptions: [],
        attributes: [],
        isDeleted: false,
      })
      .catch(() => null);

    await barrier.waitUntilReached(15000, 'Enrichment');
    await apiProductService.delete(productId as number, user);
    barrier.release();
    await enrichPromise;

    const final = await productRepository.findOne({ where: { id: productId } });
    expect(final!.isDeleted).toBe(true);
    expect(final!.status).toBe('inactive');

    const activePav = await crawlerConnection.query(
      `SELECT COUNT(*) AS cnt FROM product_attribute_value WHERE productId = ? AND isDeleted = 0`,
      [productId],
    );
    expect(Number(activePav[0].cnt)).toBe(0);
  });
});
