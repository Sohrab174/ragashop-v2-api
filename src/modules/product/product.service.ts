import { Body, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { getEffectiveCrawlerBaseUrl } from '@ragashop/marketplace-identity-lease';
import {
  getConnection,
  Repository,
  IsNull,
  In,
  Not,
  LessThanOrEqual,
  MoreThanOrEqual,
  QueryRunner,
} from 'typeorm';
import { ErrorService } from '../../error/error.service';
import * as path from 'path';
import * as fs from 'fs';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  getDuplicateItems,
  paginationResult,
  sleep,
} from '../../utils';
import { containsPersianScript } from '../../utils/persian-script.util';
import { CategoryService } from '../category/category.service';
import { CategoryStatus } from '../category/entities/category.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductEntity, ProductStatus } from './entities/product.entity';
import {
  applyDiscoveryEligibilityFilters,
  discoveryEligibilitySql,
} from './discovery-eligibility';
import {
  ProductGalleryEntity,
  ProductGalleryType,
} from './entities/product-gallery.entity';
import {
  applyPathToThumbPath,
  generateThumbnail,
  optimizeImage,
} from '../../utils/sharp';
import { getLastDisplayOrder } from '../../utils/last-display-order';
import { ProductSortDto } from './dto/product-sort.dto';
import { AttributeService } from '../attribute/attribute.service';
import { ProductAttributeValueEntity } from './entities/product-attribute-value.entity';
import { CreateUpdateProductAttrValueDto } from './dto/create-update-product-attr-value.dto';
import { OrderStatus } from '../order/entities/order.entity';
import { AttributeTypes } from '../attribute/entities/attribute.entity';
import { UserEntity } from '../user/entities/user.entity';
import * as xlsx from 'xlsx';
import { ProductImportExcelDto } from './dto/product-import-excel.dto';
import { CreateProductGalleryDto } from './dto/create-product-gallery.dto';
import { CrawlerService } from '../../thirdParty/crawler/crawler.service';
import { ProductDescriptionEntity } from './entities/product-description.entity';
import { BrandService } from '../brand/brand.service';
import { SettingService } from '../setting/setting.service';
import { TranslatorService } from '../../thirdParty/translator/translator.service';
import { FileStorageService } from '../../file-storage.service';
import { CustomerEntity } from '../customer/entities/customer.entity';
import { UpdateGroupProductDto } from './dto/update-group-product.dto';
import axios from 'axios';
// import { Cache } from 'cache-manager';
import { IncredibleOfferEntity } from '../incredible-offer/entities/Incredible-offer.entity';
import {
  PRODUCT_DELETION_PATCH,
  assertProductEligibleForChildMutation,
  groupMutationEligibilityWhere,
  productUpdateEligibilityWhere,
} from './product-lifecycle.util';
import { ProductChildMutationLockService } from './product-child-mutation-lock.service';
import { loadOrderReferencedPavIds } from './pav-reference.util';
import { selectCanonicalActivePav } from './pav-selection.util';
import {
  galleryLogicalKey,
  isAdminOwnedDescription,
} from './product-child-sync.util';
import {
  legacyListingGenderPredicate,
  splitEqualityGenderFilter,
} from '../catalog/storefront-gender-safety';

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(ProductEntity)
    private productRepository: Repository<ProductEntity>,

    @InjectRepository(ProductAttributeValueEntity)
    private productAttributeValueRepository: Repository<ProductAttributeValueEntity>,

    @InjectRepository(ProductDescriptionEntity)
    private descriptionRepository: Repository<ProductDescriptionEntity>,

    @InjectRepository(ProductGalleryEntity)
    private galleryRepository: Repository<ProductGalleryEntity>,

    @InjectRepository(IncredibleOfferEntity)
    private incredibleOffersRepository: Repository<IncredibleOfferEntity>,

    private error: ErrorService,
    private categoryService: CategoryService,
    private attributeService: AttributeService,
    private brandService: BrandService,
    private settingService: SettingService,

    private crawlerService: CrawlerService,
    private translatorService: TranslatorService,
    private readonly fileStorage: FileStorageService,
    private readonly productChildMutationLockService: ProductChildMutationLockService,
  ) {}

  /**
   * -------------------------------------------------------
   * GET /products/galleries/admin
   */
  async getAllGalleries(page = 1, limit = 20, filters = null, sorts = null) {
    let builder = this.galleryRepository
      .createQueryBuilder('gallery')
      .leftJoinAndSelect('gallery.products', 'products')
      .andWhere('products.id IS NULL');

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('gallery.createdAt', 'ASC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    const [items, totalItems] = await builder
      .take(limit)
      .skip((page - 1) * limit)
      .getManyAndCount();

    return {
      items,
      pagination: paginationResult(page, limit, totalItems),
    };
  }

  /**
   * -------------------------------------------------------
   * GET /products/admin
   */
  async getAllForAdmin(
    page = 1,
    limit = 20,
    filters = null,
    sorts = null,
    number = null,
    name = null,
    extras: {
      search?: string | null;
      stock?: string | null;
      discounted?: string | null;
      minPrice?: string | number | null;
      maxPrice?: string | number | null;
    } = {},
  ) {
    let builder = this.productRepository
      .createQueryBuilder('product')
      .innerJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.cover', 'cover')
      .leftJoinAndSelect('product.brand', 'brand')
      .leftJoinAndSelect(
        'product.productAttributeValues',
        'productAttributeValues',
      )
      .andWhere({ isDeleted: false })
      .andWhere('product.categoryId != 1');

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('product.displayOrder', 'ASC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    if (number) {
      builder.andWhere(
        '(product.number LIKE :number OR productAttributeValues.number LIKE :number)',
        { number: `%${number}%` },
      );
    }

    if (name) {
      builder.andWhere(
        '(product.name LIKE :name OR product.sourceName LIKE :name)',
        {
          name: `%${name}%`,
        },
      );
    }

    const search = extras?.search?.toString()?.trim();
    if (search) {
      builder.andWhere(
        '(product.name LIKE :search OR product.sourceName LIKE :search OR product.number LIKE :search OR productAttributeValues.number LIKE :search)',
        { search: `%${search}%` },
      );
    }

    const stock = extras?.stock?.toString()?.trim();
    if (stock === 'in_stock') {
      // quantity -1 = untracked/available; quantity > 0 = tracked stock
      builder.andWhere('product.quantity <> 0');
    } else if (stock === 'out_of_stock') {
      builder.andWhere('product.quantity = 0');
    }

    const discounted = extras?.discounted?.toString()?.trim();
    if (discounted === '1' || discounted === 'true') {
      builder.andWhere(
        'product.discountPercent IS NOT NULL AND product.discountPercent > 0',
      );
    } else if (discounted === '0' || discounted === 'false') {
      builder.andWhere(
        '(product.discountPercent IS NULL OR product.discountPercent <= 0)',
      );
    }

    const minPrice =
      extras?.minPrice != null && extras.minPrice !== ''
        ? Number(extras.minPrice)
        : null;
    const maxPrice =
      extras?.maxPrice != null && extras.maxPrice !== ''
        ? Number(extras.maxPrice)
        : null;
    if (minPrice != null && !Number.isNaN(minPrice)) {
      builder.andWhere('product.price >= :minPrice', { minPrice });
    }
    if (maxPrice != null && !Number.isNaN(maxPrice)) {
      builder.andWhere('product.price <= :maxPrice', { maxPrice });
    }

    const [items, totalItems] = await builder
      .take(limit)
      .skip((page - 1) * limit)
      .getManyAndCount();

    return {
      items,
      pagination: paginationResult(page, limit, totalItems),
    };
  }

  /**
   * -------------------------------------------------------
   * GET /products/with-attributes/admin
   */
  async getAllForAdminWithAttributes() {
    const builder = this.productRepository
      .createQueryBuilder('product')
      .innerJoin('product.category', 'category', 'category.status = :status', {
        status: CategoryStatus.active,
      })
      .leftJoin(
        'product.productAttributeValues',
        'productAttributeValues',
        'productAttributeValues.isDeleted = 0',
      )
      .leftJoin('productAttributeValues.attributeValue', 'attributeValue')
      .leftJoin('attributeValue.attribute', 'attribute')
      .select([
        'product.id',
        'product.price',
        'product.quantity',
        'product.discountedPrice',
        'product.name',
        'productAttributeValues.id',
        'productAttributeValues.price',
        'productAttributeValues.quantity',
        'productAttributeValues.discountedPrice',
        'productAttributeValues.attributeValueId',
        'attributeValue.id',
        'attributeValue.extraValue',
        'attributeValue.value',
        'attribute.id',
        'attribute.type',
        'attribute.name',
      ])
      .andWhere('product.status = :status', {
        product: ProductStatus.active,
      })
      .andWhere('product.categoryId != 1')
      .andWhere({ isDeleted: false })
      .orderBy('product.displayOrder', 'ASC');

    const products = await builder.getMany();

    const list = [];
    products.forEach((product) => {
      const multipleAttributes = getDuplicateItems(
        product.productAttributeValues.map((pav) => ({
          ...pav,
          attributeId: pav?.attributeValue?.attribute?.id,
        })),
        'attributeId',
      );

      if (multipleAttributes) {
        multipleAttributes.forEach((pav) => {
          list.push({
            id: pav?.attributeValue?.id || null,
            productId: product.id,
            productAttributeValueId: pav.id,
            price:
              pav.discountedPrice ||
              product.discountedPrice ||
              pav.price ||
              product.price,
            quantity: pav.quantity || product.quantity,
            name: product.name,
            attributeValue: pav?.attributeValue || null,
          });
        });
      } else {
        list.push({
          id: product.id,
          productId: product.id,
          productAttributeValueId: null,
          price: product.discountedPrice || product.price,
          quantity: product.quantity,
          name: product.name,
          attributeValue: null,
        });
      }
    });

    return list;
  }

  /**
   * -------------------------------------------------------
   * GET /products/:id/attribute-value/admin
   */
  async getAttributesByProductId(productId: number) {
    const builder = this.productAttributeValueRepository
      .createQueryBuilder('attrValue')
      .innerJoinAndSelect('attrValue.attributeValue', 'attributeValue')
      .innerJoinAndSelect('attributeValue.attribute', 'attribute')
      .where({ productId, isDeleted: false });

    const productAttrValues = await builder.getMany();

    if (!productAttrValues) {
      this.error.unprocessableEntity(['مقدار مشخصه محصول موردنظر پیدا نشد']);
    }

    return productAttrValues;
  }

  /**
   * -------------------------------------------------------
   * GET /products/:id/admin
   */
  async getByIdForAdmin(id: number) {
    const builder = this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.cover', 'cover')
      .leftJoinAndSelect('product.productDescriptions', 'productDescriptions')
      .innerJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.brand', 'brand')
      .where({ id })
      .andWhere('product.categoryId != 1')
      .andWhere({ isDeleted: false });

    const product = await builder.getOne();

    if (!product) {
      this.error.unprocessableEntity(['محصول مورد نظر یافت نشد!']);
    }

    return product;
  }

  /**
   * -------------------------------------------------------
   * GET /products/:id
   */
  // async getById(id: number) {
  //   // const builder = this.productRepository
  //   //   .createQueryBuilder('product')
  //   //   .leftJoinAndSelect('product.cover', 'cover')
  //   //   .leftJoinAndSelect('product.productGalleries', 'productGalleries')
  //   //   .leftJoinAndSelect('product.productDescriptions', 'productDescriptions')
  //   //   .innerJoinAndSelect('product.category', 'category')
  //   //   .leftJoinAndSelect('product.brand', 'brand')
  //   //   // Product incredible offers
  //   //   .leftJoin(
  //   //     'product.incredibleOffers',
  //   //     'productIncredibleOffers',
  //   //     'productIncredibleOffers.fromDate <= :now AND productIncredibleOffers.toDate >= :now AND productIncredibleOffers.productAttributeValueId IS NULL',
  //   //     { now: new Date() },
  //   //   )
  //   //   .addSelect('productIncredibleOffers.id')
  //   //   .addSelect('productIncredibleOffers.discountedPrice')
  //   //   .addSelect('productIncredibleOffers.toDate')

  //   //   .leftJoinAndSelect(
  //   //     'product.productAttributeValues',
  //   //     'productAttributeValues',
  //   //     'productAttributeValues.isDeleted = 0',
  //   //   )
  //   //   .leftJoinAndSelect(
  //   //     'productAttributeValues.attributeValue',
  //   //     'attributeValue',
  //   //   )
  //   //   .leftJoinAndSelect('attributeValue.attribute', 'attribute')

  //   //   // Product incredible offers for attributes
  //   //   .leftJoin(
  //   //     'productAttributeValues.incredibleOffers',
  //   //     'productAttributeIncredibleOffers',
  //   //     'productAttributeIncredibleOffers.fromDate <= :now AND productAttributeIncredibleOffers.toDate >= :now',
  //   //     { now: new Date() },
  //   //   )
  //   //   .addSelect('productAttributeIncredibleOffers.id')
  //   //   .addSelect('productAttributeIncredibleOffers.discountedPrice')
  //   //   .addSelect('productAttributeIncredibleOffers.toDate')
  //   //   .where({ id })
  //   //   .andWhere('product.categoryId != 1')
  //   //   .andWhere({ isDeleted: false });

  //   // builder.andWhere({ status: ProductStatus.active });

  //   // const product: ProductEntity & {
  //   //   incredibleOfferExpire?: Date;
  //   //   productAttributeValues: any;
  //   // } = await builder.getOne();
  //   const product = await this.productRepository.query(
  //     'CALL get_product_details(?)',
  //     [id],
  //   );

  //   if (!product) {
  //     this.error.unprocessableEntity(['محصول مورد نظر یافت نشد!']);
  //   }

  //   const tryToToman = await this.settingService.getTryToToman();

  //   product.discountedPrice =
  //     tryToToman *
  //     (product.incredibleOffers?.[0]?.discountedPrice ||
  //       product.discountedPrice);

  //   product.incredibleOfferExpire =
  //     product.incredibleOffers?.[0]?.toDate || null;

  //   product.productAttributeValues = product.productAttributeValues.map(
  //     (pav) => {
  //       pav.discountedPrice =
  //         tryToToman *
  //         (pav.incredibleOffers?.[0]?.discountedPrice || pav.discountedPrice);
  //       pav.incredibleOfferExpire = pav.incredibleOffers?.[0]?.toDate || null;
  //       pav.price = tryToToman * pav.price;
  //       delete pav.incredibleOffers;
  //       return pav;
  //     },
  //   );

  //   delete product.incredibleOffers;

  //   (product as any).relatedProducts = await this.productRepository
  //     .createQueryBuilder('product')
  //     .leftJoin('product.cover', 'cover')
  //     .select([
  //       'product.id',
  //       'product.name',
  //       'cover.id',
  //       'cover.type',
  //       'cover.pathFile',
  //     ])
  //     .where({
  //       isDeleted: false,
  //       sourceGroupId: product.sourceGroupId,
  //       id: Not(product.id),
  //     })
  //     .andWhere('product.categoryId != 1')
  //     .getMany();

  //   return {
  //     ...product,
  //     price: product.price * tryToToman,
  //   };

  //   // if (product.coverId && product.productGalleries?.length === 1) {
  //   //   return product;
  //   // }

  //   // return {
  //   //   ...product,
  //   //   productGalleries: product.productGalleries.filter(
  //   //     (g) => g.id !== product.coverId,
  //   //   ),
  //   // };
  // }
  async getById(id: number) {
    const now = new Date();

    // ─────────────────────────────────────
    // 1) Load main product (small, cheap)
    // ─────────────────────────────────────
    const product = await this.productRepository.findOne({
      where: {
        id,
        isDeleted: false,
        categoryId: Not(1),
        status: ProductStatus.active,
      },
      relations: ['cover', 'category', 'brand'],
    });

    if (!product) {
      this.error.unprocessableEntity(['محصول مورد نظر یافت نشد!']);
    }

    // ─────────────────────────────────────
    // 2) Load related simple relations
    // ─────────────────────────────────────
    const descriptionsPromise = this.descriptionRepository.find({
      where: { productId: id },
    });

    const galleriesPromise = this.galleryRepository.find({
      where: { productId: id },
    });

    // ─────────────────────────────────────
    // 3) Load productAttributeValues + attribute/attributeValue
    // ─────────────────────────────────────
    const attributeValuesPromise = this.productAttributeValueRepository.find({
      where: { productId: id, isDeleted: false },
      relations: ['attributeValue', 'attributeValue.attribute'],
    });

    // ─────────────────────────────────────
    // 4) Load incredible offers (product-level)
    // ─────────────────────────────────────
    const productOffersPromise = this.incredibleOffersRepository.find({
      where: {
        productId: id,
        productAttributeValueId: null,
        fromDate: LessThanOrEqual(now),
        toDate: MoreThanOrEqual(now),
      },
      select: ['id', 'discountedPrice', 'toDate'],
    });

    // ─────────────────────────────────────
    // 5) Load attribute-value-level incredible offers
    // ─────────────────────────────────────
    const attributeOffersPromise = this.incredibleOffersRepository.find({
      where: {
        productId: id,
        productAttributeValueId: Not(null),
        fromDate: LessThanOrEqual(now),
        toDate: MoreThanOrEqual(now),
      },
      select: ['id', 'discountedPrice', 'toDate', 'productAttributeValueId'],
    });

    // ─────────────────────────────────────
    // 6) Load related products (separate small query)
    // ─────────────────────────────────────
    const relatedProductsPromise = this.productRepository.find({
      where: {
        isDeleted: false,
        categoryId: Not(1),
        status: ProductStatus.active,
        sourceGroupId: product.sourceGroupId,
        id: Not(product.id),
      },
      relations: ['cover'],
      take: 10,
    });

    // Run everything in parallel (massive speed-up)
    const [
      descriptions,
      galleries,
      attributeValues,
      productOffers,
      attributeOffers,
      relatedProducts,
    ] = await Promise.all([
      descriptionsPromise,
      galleriesPromise,
      attributeValuesPromise,
      productOffersPromise,
      attributeOffersPromise,
      relatedProductsPromise,
    ]);

    // ─────────────────────────────────────
    // 7) Attach data
    // ─────────────────────────────────────
    product.productDescriptions = descriptions;
    product.productGalleries = galleries;
    product.productAttributeValues = attributeValues;
    (product as any).relatedProducts = relatedProducts;

    // ─────────────────────────────────────
    // 8) Pricing conversion
    // ─────────────────────────────────────
    const tryToToman = await this.settingService.getTryToToman();

    // Product-level offer
    const activeProductOffer = productOffers[0];
    product.discountedPrice =
      tryToToman *
      (activeProductOffer?.discountedPrice ?? product.discountedPrice);

    (product as any).incredibleOfferExpire = activeProductOffer?.toDate ?? null;

    // Attribute-level offers
    const attrOfferMap = new Map(
      attributeOffers.map((o) => [o.productAttributeValueId, o]),
    );

    product.productAttributeValues = product.productAttributeValues.map(
      (pav) => {
        const offer = attrOfferMap.get(pav.id);
        pav.discountedPrice =
          tryToToman * (offer?.discountedPrice ?? pav.discountedPrice);
        (pav as any).incredibleOfferExpire = offer?.toDate ?? null;
        pav.price = pav.price * tryToToman;
        return pav;
      },
    );

    // ─────────────────────────────────────
    // 9) Return final product
    // ─────────────────────────────────────
    return {
      ...product,
      price: product.price * tryToToman,
    };
  }

  /**
   * -------------------------------------------------------
   * Legacy link import — disabled; use POST /marketplace-imports
   */
  async getByLink(_link: string) {
    this.error.methodNotAllowed([
      'این مسیر دیگر پشتیبانی نمی‌شود. لطفاً از جستجوی محصول در سایت استفاده کنید.',
    ]);
  }

  private getCrawlerBaseUrl(): string {
    return getEffectiveCrawlerBaseUrl(process.env);
  }

  private getCrawlerHeaders(): Record<string, string> {
    const secret = process.env.CRAWLER_INTERNAL_SECRET;
    return secret ? { 'x-crawler-secret': secret } : {};
  }

  /**
   * -------------------------------------------------------
   * GET /products
   */
  async getAll(
    page = 1,
    limit = 20,
    filters,
    sorts = null,
    categoryId = null,
    priceRanges: any = {},
    search = null,
    attributes = [],
    customer: CustomerEntity,
  ) {
    // let filtersAsString = '';
    // const filterKeys = Object.keys(filters);
    // if (filterKeys.length) {
    //   filterKeys.map((item) => {
    //     filtersAsString += `${item}${filters[item]}`;
    //   });
    // }
    // let priceRangeAsString = '';
    // const priceKeys = Object.keys(priceRanges);
    // if (priceKeys.length) {
    //   priceKeys.map((item) => {
    //     priceRangeAsString += `${item}${priceRanges[item]}`;
    //   });
    // }
    // let attributesAsString = '';
    // if (attributes.length) {
    //   attributes.map((item) => {
    //     attributesAsString += item.toString();
    //   });
    // }

    // const key = `products:${categoryId}`;
    // console.log(key);

    // const cached = await this.cache.get(key);

    // if (cached) {
    //   console.log('cache hit');
    //   const parsedCache = JSON.parse(cached);

    //   return parsedCache;
    // }

    let categoryIds = [];
    if (categoryId) {
      categoryIds = [
        categoryId,
        ...(await this.categoryService.getChildIds(categoryId)),
      ]
        .map((cId) => +cId)
        .filter((cId) => cId > 1);
    }

    let builder = this.productRepository
      .createQueryBuilder('product')
      .innerJoin('product.category', 'category', 'category.status = :status', {
        status: CategoryStatus.active,
      })
      .leftJoinAndSelect('product.cover', 'cover')
      .leftJoinAndSelect('product.brand', 'brand')
      .andWhere({ status: ProductStatus.active })
      .andWhere({ isDeleted: false })
      .andWhere('product.price > 0')
      .andWhere('product.categoryId != 1');
    applyDiscoveryEligibilityFilters(builder, 'product');

    if (categoryIds.length > 0) {
      builder.andWhere('product.categoryId IN (:...categoryIds)', {
        categoryIds,
      });
    }

    if (attributes.length > 0) {
      builder.innerJoin(
        'product.productAttributeValues',
        'productAttributeValues',
        'productAttributeValues.isDeleted = 0 AND productAttributeValues.attributeValueId IN (:...attributes)',
        { attributes },
      );
    }

    if (search) {
      // sourceName ommited from query
      builder.andWhere(
        '(product.name LIKE :search OR brand.sourceName LIKE :search OR category.name LIKE :search)',
        {
          search: `%${search}%`,
        },
      );
    }

    // if (gender) {
    //   builder.andWhere(
    //     `(product.gender = :gender OR product.gender = 'unisex')`,
    //     {
    //       gender,
    //     },
    //   );
    // }

    // Product incredible offers
    // builder
    //   .leftJoin(
    //     'product.incredibleOffers',
    //     'productIncredibleOffers',
    //     'productIncredibleOffers.fromDate <= :now AND productIncredibleOffers.toDate >= :now AND productIncredibleOffers.productAttributeValueId IS NULL',
    //     { now: new Date() },
    //   )
    //   .addSelect('productIncredibleOffers.id')
    //   .addSelect('productIncredibleOffers.discountedPrice')
    //   .addSelect('productIncredibleOffers.toDate')

    //   // Product attribute value
    //   .leftJoin(
    //     'product.productAttributeValues',
    //     'productAttributeValues',
    //     'productAttributeValues.isDeleted = 0',
    //   )
    //   .leftJoin('productAttributeValues.attributeValue', 'attributeValue')
    //   .leftJoin(
    //     'attributeValue.attribute',
    //     'attribute',
    //     'attribute.type = :type',
    //     { type: AttributeTypes.color },
    //   )
    //   .addSelect('productAttributeValues.id')
    //   .addSelect('productAttributeValues.price')
    //   .addSelect('productAttributeValues.discountedPrice')
    //   .addSelect('productAttributeValues.quantity')
    //   .addSelect('attributeValue.id')
    //   .addSelect('attributeValue.extraValue')
    //   .addSelect('attribute.id')

    //   // Product incredible offers for attributes
    //   .leftJoin(
    //     'productAttributeValues.incredibleOffers',
    //     'productAttributeIncredibleOffers',
    //     'productAttributeIncredibleOffers.fromDate <= :now AND productAttributeIncredibleOffers.toDate >= :now',
    //     { now: new Date() },
    //   )
    //   .addSelect('productAttributeIncredibleOffers.id')
    //   .addSelect('productAttributeIncredibleOffers.discountedPrice')
    //   .addSelect('productAttributeIncredibleOffers.toDate');

    // MIN(
    //   COALESCE(
    //     NULLIF(productAttributeValues.discountedPrice, 0),
    //     NULLIF(productAttributeValues.price, 0)
    //   )
    // ) OVER (PARTITION BY product.id),
    builder.addSelect(
      `COALESCE(
          NULLIF(product.discountedPrice, 0),
          NULLIF(product.price, 0),
          0
        )`,
      'mainPrice',
    );

    if (sorts) {
      if (sorts[0].field === 'sales') {
        builder.leftJoin('product.orderItems', 'orderItems');
        builder.leftJoin(
          'orderItems.order',
          'order',
          'order.status IN (:...statuses)',
          {
            statuses: [
              OrderStatus.paid,
              OrderStatus.sent,
              OrderStatus.delivered,
            ],
          },
        );
        builder.addSelect('COUNT(order.id)', 'order_count');
        builder.groupBy('product.id');
        builder.orderBy('order_count', sorts[0].dir);
      } else if (sorts[0].field === 'price') {
        builder.orderBy('mainPrice', sorts[0].dir);
      } else {
        builder = applySortingToBuilder(builder, sorts);
      }
    } else {
      // builder.orderBy('product.displayOrder', 'ASC');
      builder.orderBy('RAND()');
    }

    const genderSplit = splitEqualityGenderFilter(filters);
    filters = genderSplit.filters;
    const sectionGender = legacyListingGenderPredicate(
      'product',
      genderSplit.gender,
    );
    if (sectionGender) {
      builder.andWhere(sectionGender.sql, sectionGender.params);
    }

    builder = applyFiltersToBuilder(builder, filters);

    if (priceRanges?.minPrice && priceRanges?.maxPrice) {
      // NULLIF(productAttributeValues.discountedPrice, 0),
      // NULLIF(productAttributeValues.price, 0),
      builder.andWhere(
        `COALESCE(
          NULLIF(product.discountedPrice, 0),
          NULLIF(product.price, 0),
          0
        ) BETWEEN :minPrice AND :maxPrice`,
        priceRanges,
      );
    }

    // TODO: --------------------------------------
    // Group by sourceGroupId and get the first product of each group using a subquery
    // const subQuery = this.productRepository
    //   .createQueryBuilder('subProduct')
    //   .select('subProduct.id', 'id')
    //   .addSelect(
    //     'ROW_NUMBER() OVER (PARTITION BY subProduct.sourceGroupId ORDER BY subProduct.id)',
    //     'row_num',
    //   )
    //   .andWhere({ status: ProductStatus.active })
    //   .andWhere({ isDeleted: false });

    // builder.innerJoin(
    //   `(${subQuery.getQuery()})`,
    //   'groupedProducts',
    //   'groupedProducts.id = product.id AND groupedProducts.row_num = 1',
    // );

    if (customer) {
      builder
        .leftJoin(
          'product.favorites',
          'favorites',
          'favorites.isDeleted = 0 AND favorites.customerId = :customerId',
          { customerId: customer.id },
        )
        .addSelect(['favorites.id']);
    }

    const [items, totalItems] = await builder
      .take(limit)
      .skip((page - 1) * limit)
      .getManyAndCount();

    builder.select([
      'MIN(COALESCE(product.discountedPrice, product.price)) AS minPrice',
      'MAX(COALESCE(product.discountedPrice, product.price)) AS maxPrice',
    ]);
    // .innerJoin('product.category', 'category', 'category.status = :status', {
    //   status: CategoryStatus.active,
    // })
    // .leftJoin(
    //   'product.productAttributeValues',
    //   'productAttributeValues',
    //   'productAttributeValues.isDeleted = 0',
    // )
    // .andWhere({ isDeleted: false })
    // .andWhere('product.categoryId != 1')
    // .andWhere({ status: ProductStatus.active });

    // if (filters[0]?.data[0]?.value || gender[0]?.data[0]?.value) {
    //   if (filters[0].data[0].value !== 2) {
    //     builder = applyFiltersToBuilder(builder, filters);
    //   } else {
    //     builder = applyFiltersToBuilder(builder, gender);
    //   }
    // }
    // const prices = await builder.getRawOne();

    // const tryToToman = await this.settingService.getTryToToman();

    // return {
    //   minPrice: Math.round(prices.minPrice * tryToToman),
    //   maxPrice: Math.round(prices.maxPrice * tryToToman),
    // };
    const prices = await builder.getRawOne();
    const tryToToman = await this.settingService.getTryToToman();
    // const productResponse = {
    //   items: items.map((item) => this.mappingProduct(item, tryToToman)),
    //   pagination: paginationResult(page, limit, totalItems),
    //   prices: {
    //     minPrice: Math.round(prices.minPrice * tryToToman),
    //     maxPrice: Math.round(prices.maxPrice * tryToToman),
    //   },
    // };
    // await this.cache.set(
    //   key,
    //   JSON.stringify({
    //     items: items.map((item) => this.mappingProduct(item, tryToToman)),
    //     pagination: paginationResult(page, limit, totalItems),
    //     prices: {
    //       minPrice: Math.round(prices.minPrice * tryToToman),
    //       maxPrice: Math.round(prices.maxPrice * tryToToman),
    //     },
    //   }),
    //   600,
    // );
    return {
      items: items.map((item) => this.mappingProduct(item, tryToToman)),
      pagination: paginationResult(page, limit, totalItems),
      prices: {
        minPrice: Math.round(prices.minPrice * tryToToman),
        maxPrice: Math.round(prices.maxPrice * tryToToman),
      },
    };
  }

  /**
   * -------------------------------------------------------
   * GET /products/summary
   */
  async getSummaries(limitPerCategory = 4) {
    const targetProductList = await getConnection()
      .createQueryBuilder()
      .select('product.id')
      .from(
        (subQuery) =>
          subQuery
            .select(
              'p.id, ROW_NUMBER() OVER (PARTITION BY p.categoryId ORDER BY displayOrder ASC) as row_num',
            )
            .from(ProductEntity, 'p')
            .where(' p.status = :status', {
              status: ProductStatus.active,
            })
            .andWhere('p.isDeleted = :isDeleted', { isDeleted: false })
            .andWhere('p.categoryId != 1')
            .andWhere('p.price > 0')
            .andWhere(discoveryEligibilitySql('p')),
        'product',
      )
      .andWhere('product.row_num <= :num', { num: limitPerCategory })
      .getRawMany();

    // Not found
    if (targetProductList?.length === 0) {
      return [];
    }

    const summaryBuilder = this.productRepository
      .createQueryBuilder('product')
      .innerJoin('product.category', 'category', 'category.status = :status', {
        status: CategoryStatus.active,
      })

      .leftJoin('product.cover', 'cover')
      .addSelect('cover.type')
      .addSelect('cover.pathFile')

      .leftJoin(
        'product.productAttributeValues',
        'productAttributeValues',
        'productAttributeValues.isDeleted = 0',
      )
      .leftJoin('productAttributeValues.attributeValue', 'attributeValue')
      .leftJoin(
        'attributeValue.attribute',
        'attribute',
        'attribute.type = :type',
        { type: AttributeTypes.color },
      )
      .addSelect('productAttributeValues.id')
      .addSelect('productAttributeValues.price')
      .addSelect('productAttributeValues.discountedPrice')
      .addSelect('attributeValue.id')
      .addSelect('attributeValue.extraValue')
      .addSelect('attribute.id')
      .andWhere({ status: ProductStatus.active })
      .andWhere('product.id IN (:...ids)', {
        ids: targetProductList.map((p) => p.id),
      })
      .andWhere({ isDeleted: false })
      .andWhere('product.categoryId != 1');
    applyDiscoveryEligibilityFilters(summaryBuilder, 'product');

    const productList = await summaryBuilder
      .orderBy('product.displayOrder', 'ASC')
      .getMany();

    const tryToToman = await this.settingService.getTryToToman();

    return productList.map((item) => this.mappingProduct(item, tryToToman));
  }

  /**
   * Canonical active PAV for (productId, attributeValueId) — used by
   * field-level capability checks before mutation.
   */
  async findCanonicalActivePav(
    productId: number,
    attributeValueId: number,
  ): Promise<ProductAttributeValueEntity | null> {
    const referencedPavIds = await loadOrderReferencedPavIds(
      this.productAttributeValueRepository.manager,
      productId,
    );
    const existingForValue = await this.productAttributeValueRepository.find({
      where: {
        productId,
        attributeValueId,
      },
    });
    return (
      (selectCanonicalActivePav(
        existingForValue,
        referencedPavIds,
      ) as ProductAttributeValueEntity | null) || null
    );
  }

  /**
   * -------------------------------------------------------
   * POST & PUT /products/attribute/admin
   */
  async addUpdateProductAttributeValue(
    dto: CreateUpdateProductAttrValueDto,
    user?: UserEntity,
  ) {
    return this.productChildMutationLockService.withProductChildLock(
      dto.productId,
      async () => {
        const product = await this.productRepository
          .createQueryBuilder('product')
          .andWhere({ id: dto.productId })
          .getOne();

        const attributeValue = await this.attributeService.getRecordById(
          dto.attributeValueId,
        );

        if (!attributeValue) {
          this.error.unprocessableEntity(['این درخواست نامعتبر است']);
        }

        assertProductEligibleForChildMutation(product, this.error);

        const referencedPavIds = await loadOrderReferencedPavIds(
          this.productAttributeValueRepository.manager,
          dto.productId,
        );

        const existingForValue =
          await this.productAttributeValueRepository.find({
            where: {
              productId: dto.productId,
              attributeValueId: dto.attributeValueId,
            },
          });

        const productAttrValue = selectCanonicalActivePav(
          existingForValue,
          referencedPavIds,
        ) as ProductAttributeValueEntity | null;

        await this.checkDuplicateProductNumber(
          'attribute',
          dto.number,
          product.id,
          productAttrValue?.id,
        );

        if (productAttrValue) {
          if (dto.number !== undefined) {
            productAttrValue.number = dto.number;
          }
          if (dto.quantity !== undefined) {
            productAttrValue.quantity = dto.quantity;
          }
          if (dto.price !== undefined) {
            productAttrValue.price = dto.price;
          }
          if (dto.discountedPrice !== undefined) {
            productAttrValue.discountedPrice = dto.discountedPrice;
          }
          if (dto.price !== undefined || dto.discountedPrice !== undefined) {
            let discountPercent = 0;
            const price = productAttrValue.price;
            const discountedPrice = productAttrValue.discountedPrice;
            if (price && discountedPrice != null && price > 0) {
              discountPercent = ((price - discountedPrice) / price) * 100;
            }
            productAttrValue.discountPercent = discountPercent;
          }
          if (dto.purchaseCost !== undefined) {
            productAttrValue.purchaseCost = dto.purchaseCost;
            productAttrValue.costUpdatedAt = new Date();
            productAttrValue.costUpdatedByUserId = user?.id ?? null;
            productAttrValue.costSource =
              dto.costSource || productAttrValue.costSource || 'manual_admin';
          }
          if (dto.landedUnitCost !== undefined) {
            productAttrValue.landedUnitCost = dto.landedUnitCost;
            productAttrValue.costUpdatedAt = new Date();
            productAttrValue.costUpdatedByUserId = user?.id ?? null;
            productAttrValue.costSource =
              dto.costSource || productAttrValue.costSource || 'manual_admin';
          }
          if (dto.costCurrency !== undefined) {
            productAttrValue.costCurrency = dto.costCurrency as any;
            productAttrValue.costUpdatedAt = new Date();
            productAttrValue.costUpdatedByUserId = user?.id ?? null;
          }
          if (dto.costSource !== undefined) {
            productAttrValue.costSource = dto.costSource;
            productAttrValue.costUpdatedAt = new Date();
            productAttrValue.costUpdatedByUserId = user?.id ?? null;
          }

          await productAttrValue.save();

          return { id: productAttrValue.id };
        }

        if (
          !(await this._isValidCreateNewAttributeValue(
            dto.productId,
            dto.attributeValueId,
          ))
        ) {
          this.error.unprocessableEntity([
            'امکان تعریف بیش از یک ویژگی چندگانه وجود ندارد',
          ]);
        }

        let discountPercent = 0;
        if (dto.price && dto.discountedPrice != null && dto.price > 0) {
          discountPercent =
            ((dto.price - dto.discountedPrice) / dto.price) * 100;
        }

        const { identifiers } = await this.productAttributeValueRepository
          .createQueryBuilder()
          .insert()
          .values({
            productId: dto.productId,
            attributeValueId: dto.attributeValueId,
            number: dto.number || null,
            quantity:
              dto.quantity === undefined || dto.quantity === null
                ? -1
                : dto.quantity,
            price: dto.price || null,
            discountedPrice: dto.discountedPrice || null,
            discountPercent,
            purchaseCost: dto.purchaseCost ?? null,
            landedUnitCost: dto.landedUnitCost ?? null,
            costCurrency: (dto.costCurrency as any) || null,
            costSource: dto.costSource || null,
            costUpdatedAt:
              dto.purchaseCost != null || dto.landedUnitCost != null
                ? new Date()
                : null,
            costUpdatedByUserId:
              dto.purchaseCost != null || dto.landedUnitCost != null
                ? user?.id ?? null
                : null,
            isDeleted: false,
          })
          .execute();

        return { id: identifiers[0].id };
      },
    );
  }

  /**
   * -------------------------------------------------------
   * DELETE /products/attribute/:id/admin
   */
  async deleteProductAttributeValue(id: number, user: UserEntity) {
    const productAttrValue = await this.productAttributeValueRepository.findOne(
      { where: { id } },
    );

    if (!productAttrValue) {
      this.error.unprocessableEntity(['مقدار مشخصه محصول موردنظر پیدا نشد']);
    }

    return this.productChildMutationLockService.withProductChildLock(
      productAttrValue.productId,
      async () => {
        const row = await this.productAttributeValueRepository.findOne({
          where: { id },
        });
        if (!row) {
          this.error.unprocessableEntity([
            'مقدار مشخصه محصول موردنظر پیدا نشد',
          ]);
        }
        row.isDeleted = true;
        await row.save();
        return true;
      },
    );
  }

  /**
   * -------------------------------------------------------
   * POST /products/admin
   */
  async add(dto: CreateProductDto, user: UserEntity) {
    const existCategory = await this.categoryService.getRecordById(
      dto.categoryId,
    );

    if (!existCategory) {
      this.error.unprocessableEntity(['دسته بندی انتخابی معتبر نمی باشد']);
    }

    // Checking duplicate product number
    await this.checkDuplicateProductNumber('product', dto.number);
    let discountPercent = 0;
    if (dto.price && dto.discountedPrice && dto.price > 0) {
      discountPercent = ((dto.price - dto.discountedPrice) / dto.price) * 100;
    }

    const { identifiers } = await this.productRepository
      .createQueryBuilder()
      .insert()
      .values({
        categoryId: dto.categoryId,
        name: dto.name,
        number: dto.number || null,
        quantity:
          dto.quantity === undefined || dto.quantity === null
            ? -1
            : dto.quantity,
        price: dto.price,
        discountedPrice: dto.discountedPrice || null,
        discountPercent: discountPercent,
        star: 0,
        tax: 0,
        hasStock: dto.quantity && dto.quantity > 0,
        isVasEnabled: false,
        isSellable: true,
        isBasketDiscount: false,
        isFreeCargo: false,
        isDigitalGood: false,
        isArtWork: false,
        displayOrder: await getLastDisplayOrder(ProductEntity.name),
        gender: dto?.gender || null,
        status: dto.status,
        createdAt: new Date(),
      })
      .execute();

    const newProductId = identifiers[0].id;

    if (dto.descriptions.length > 0) {
      await this.productChildMutationLockService.withProductChildLock(
        newProductId,
        async () => {
          await this.descriptionRepository
            .createQueryBuilder()
            .insert()
            .values(
              dto.descriptions.map((d) => ({
                content: d.content,
                productId: newProductId,
              })),
            )
            .execute();
        },
      );
    }

    return { id: newProductId };
  }

  /**
   * -------------------------------------------------------
   * PUT /products/admin
   */
  async update(dto: UpdateProductDto, user: UserEntity) {
    const existCategory = await this.categoryService.getRecordById(
      dto.categoryId,
    );
    if (!existCategory) {
      this.error.unprocessableEntity(['دسته بندی انتخابی معتبر نمی باشد']);
    }

    await this.checkDuplicateProductNumber('product', dto.number, dto.id);

    return this.productChildMutationLockService.withProductChildLock(
      dto.id,
      async () => {
        const product = await this.productRepository.findOne({
          where: { id: dto.id },
          relations: ['productDescriptions'],
        });

        if (!product) {
          this.error.unprocessableEntity(['محصول مورد نظر یافت نشد!']);
        }

        assertProductEligibleForChildMutation(product, this.error);

        const patch: Partial<ProductEntity> = {};
        if (dto.status !== undefined) patch.status = dto.status;
        if (dto.price !== undefined) patch.price = dto.price;
        if (dto.discountedPrice !== undefined) {
          patch.discountedPrice = dto.discountedPrice;
        }
        if (dto.coverId !== undefined) patch.coverId = dto.coverId;
        if (dto.categoryId !== undefined) patch.categoryId = dto.categoryId;
        if (dto.quantity !== undefined) patch.quantity = dto.quantity;
        if (dto.number !== undefined) patch.number = dto.number;
        if (dto.name !== undefined) patch.name = dto.name;
        if (dto.description !== undefined) patch.description = dto.description;
        if (dto.gender !== undefined) patch.gender = dto.gender;
        if (dto.purchaseCost !== undefined) {
          patch.purchaseCost = dto.purchaseCost;
          patch.costUpdatedAt = new Date();
          patch.costUpdatedByUserId = user?.id ?? null;
          if (dto.costSource !== undefined) {
            patch.costSource = dto.costSource;
          } else if (!product.costSource) {
            patch.costSource = 'manual_admin';
          }
        }
        if (dto.landedUnitCost !== undefined) {
          patch.landedUnitCost = dto.landedUnitCost;
          patch.costUpdatedAt = new Date();
          patch.costUpdatedByUserId = user?.id ?? null;
          if (dto.costSource !== undefined) {
            patch.costSource = dto.costSource;
          } else if (!product.costSource) {
            patch.costSource = 'manual_admin';
          }
        }
        if (dto.costCurrency !== undefined) {
          patch.costCurrency = dto.costCurrency as any;
          patch.costUpdatedAt = new Date();
          patch.costUpdatedByUserId = user?.id ?? null;
        }
        if (dto.costSource !== undefined && dto.purchaseCost === undefined && dto.landedUnitCost === undefined) {
          patch.costSource = dto.costSource;
          patch.costUpdatedAt = new Date();
          patch.costUpdatedByUserId = user?.id ?? null;
        }

        if (Object.keys(patch).length > 0) {
          const updateResult = await this.productRepository
            .createQueryBuilder()
            .update()
            .set(patch)
            .where(productUpdateEligibilityWhere(dto.id))
            .execute();

          if (!updateResult.affected) {
            this.error.unprocessableEntity(['محصول حذف شده است.']);
          }
        }

        if (dto.descriptions !== undefined) {
          const reloaded = await this.productRepository.findOne({
            where: { id: dto.id },
            relations: ['productDescriptions'],
          });
          assertProductEligibleForChildMutation(reloaded, this.error);

          const existDescriptionIds = dto.descriptions
            .filter((d) => !!d?.id)
            .map((d) => d.id);

          const deleteDescriptionIds = reloaded.productDescriptions
            .filter(
              (pd) =>
                isAdminOwnedDescription(pd) &&
                !existDescriptionIds.includes(pd.id),
            )
            .map((d) => d.id);
          if (deleteDescriptionIds.length > 0) {
            await this.descriptionRepository
              .createQueryBuilder()
              .update()
              .set({ isDeleted: true })
              .where('id IN (:...ids)', { ids: deleteDescriptionIds })
              .execute();
          }

          const updateDescriptions = dto.descriptions.filter(
            (d) =>
              d?.id &&
              isAdminOwnedDescription(
                reloaded.productDescriptions.find((pd) => pd.id === d.id) || {},
              ),
          );
          for (const desc of updateDescriptions) {
            await this.descriptionRepository
              .createQueryBuilder()
              .update()
              .set({ content: desc.content })
              .where({ id: desc.id })
              .execute();
          }

          const newDescriptions = dto.descriptions.filter((d) => !d?.id);
          if (newDescriptions.length > 0) {
            await this.descriptionRepository
              .createQueryBuilder()
              .insert()
              .values(
                newDescriptions.map((d) => ({
                  content: d.content,
                  productId: dto.id,
                })),
              )
              .execute();
          }
        }

        return true;
      },
    );
  }

  /**
   * -------------------------------------------------------
   * PUT /products/group/admin
   */
  async groupUpdate(dto: UpdateGroupProductDto) {
    if (!dto.categoryId && !dto.status && !dto.gender) {
      this.error.methodNotAllowed(['تغییری انتخاب نشده است!']);
    }

    await this.productRepository
      .createQueryBuilder()
      .update()
      .set({
        ...(dto.status && { status: dto.status }),
        ...(dto.gender && { gender: dto.gender }),
        ...(dto.categoryId && { categoryId: dto.categoryId }),
      })
      .where({ id: In(dto.ids), ...groupMutationEligibilityWhere() })
      .execute();
  }

  /**
   * -------------------------------------------------------
   * POST /products/photo or video/admin
   */
  async addGallery(
    dto: CreateProductGalleryDto,
    file: Express.Multer.File,
    type: ProductGalleryType,
    user: UserEntity,
  ) {
    const pathFile = `/products/${file.filename}`;

    if (!dto.productId) {
      const { identifiers } = await this.galleryRepository
        .createQueryBuilder()
        .insert()
        .values({
          pathFile,
          type,
          productId: null,
          createdAt: new Date(),
        })
        .execute();

      const newGalleryId = identifiers[0].id;

      if (type === ProductGalleryType.photo) {
        await generateThumbnail(file.path);
        await optimizeImage(file.path);
      }

      return { id: newGalleryId, pathFile, type };
    }

    if (type === ProductGalleryType.photo) {
      await generateThumbnail(file.path);
      await optimizeImage(file.path);
    }

    return this.productChildMutationLockService.withProductChildLock(
      dto.productId,
      async () => {
        const product = await this.productRepository
          .createQueryBuilder('product')
          .leftJoinAndSelect('product.productGalleries', 'productGalleries')
          .andWhere({ id: dto.productId })
          .getOne();

        if (!product) {
          this.error.unprocessableEntity(['محصول مورد نظر یافت نشد!']);
        }

        assertProductEligibleForChildMutation(product, this.error);

        const logicalKey = galleryLogicalKey(dto.productId, pathFile);
        const duplicate = (product.productGalleries || []).find(
          (g) => galleryLogicalKey(product.id, g.pathFile) === logicalKey,
        );
        if (duplicate) {
          return {
            id: duplicate.id,
            pathFile: duplicate.pathFile,
            type: duplicate.type,
          };
        }

        if (dto.isCover && product.coverId) {
          await this.deleteGalleryAlreadyLocked(product.coverId, user);
        } else if (product.productGalleries.length > 0) {
          await this.deleteGalleryAlreadyLocked(
            product.productGalleries[0].id,
            user,
          );
        }

        const { identifiers } = await this.galleryRepository
          .createQueryBuilder()
          .insert()
          .values({
            pathFile,
            type,
            productId: dto.productId,
            createdAt: new Date(),
          })
          .execute();

        const newGalleryId = identifiers[0].id;

        if (type === ProductGalleryType.photo && dto.isCover) {
          await this.productRepository
            .createQueryBuilder()
            .update()
            .set({ coverId: newGalleryId })
            .where({ id: product.id })
            .execute();
        }

        return { id: newGalleryId, pathFile, type };
      },
    );
  }

  /**
   * -------------------------------------------------------
   * DELETE /products/:id/admin
   */
  async delete(id: number, user: UserEntity) {
    return this.productChildMutationLockService.withProductChildLock(
      id,
      async () => {
        const product = await this.productRepository.findOne({
          where: { id },
          relations: ['productGalleries', 'productAttributeValues'],
        });

        if (!product) {
          this.error.unprocessableEntity(['محصول مورد نظر یافت نشد!']);
        }

        if (product.isDeleted) {
          return true;
        }

        const queryRunner =
          this.productRepository.manager.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
          const locked = await queryRunner.manager
            .createQueryBuilder(ProductEntity, 'product')
            .setLock('pessimistic_write')
            .where('product.id = :id', { id })
            .getOne();

          if (!locked || locked.isDeleted) {
            await queryRunner.commitTransaction();
            return true;
          }

          await queryRunner.manager
            .createQueryBuilder()
            .update('product_attribute_value')
            .set({ isDeleted: true })
            .where('productId = :id AND isDeleted = 0', { id })
            .execute();

          await queryRunner.manager
            .createQueryBuilder()
            .update('product_description')
            .set({ isDeleted: true })
            .where(
              "productId = :id AND isDeleted = 0 AND (source IS NULL OR source = '')",
              { id },
            )
            .execute();

          await queryRunner.manager
            .createQueryBuilder()
            .update('product')
            .set({ coverId: null })
            .where('id = :id', { id })
            .execute();

          await queryRunner.manager
            .createQueryBuilder()
            .delete()
            .from('product_gallery')
            .where('productId = :id', { id })
            .execute();

          await queryRunner.manager
            .createQueryBuilder()
            .update('product')
            .set(PRODUCT_DELETION_PATCH)
            .where({ id })
            .execute();

          await queryRunner.manager
            .createQueryBuilder()
            .update('product_favorite')
            .set({ isDeleted: true })
            .where({ productId: id, isDeleted: false })
            .execute();

          await queryRunner.commitTransaction();
        } catch (err) {
          await queryRunner.rollbackTransaction();
          throw err;
        } finally {
          await queryRunner.release();
        }

        return true;
      },
    );
  }

  /**
   * -------------------------------------------------------
   * DELETE /products/gallery/:id/admin
   */
  /**
   * Internal gallery delete — caller must already hold Product child lock when productId is set.
   */
  private async performGalleryDbDelete(gallery: {
    id: number;
    productId: number | null;
    pathFile: string;
    type: ProductGalleryType;
    product?: { coverId?: number | null };
  }): Promise<{ pathFile: string; type: ProductGalleryType }> {
    if (gallery.product && gallery.product.coverId === +gallery.id) {
      await this.productRepository
        .createQueryBuilder()
        .update()
        .set({ coverId: null })
        .where({ id: gallery.productId })
        .execute();
    }

    await this.galleryRepository
      .createQueryBuilder()
      .delete()
      .where({ id: gallery.id })
      .execute();

    return { pathFile: gallery.pathFile, type: gallery.type };
  }

  private async removeGalleryFiles(
    pathFile: string,
    type: ProductGalleryType,
  ): Promise<void> {
    const uploadsRoot = path.join(__dirname, '../../..', 'uploads');
    const targets = [path.join(uploadsRoot, pathFile)];
    if (type === ProductGalleryType.photo) {
      targets.push(path.join(uploadsRoot, applyPathToThumbPath(pathFile)));
    }

    for (const target of targets) {
      try {
        await fs.promises.unlink(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          throw error;
        }
      }
    }
  }

  private async deleteGalleryAlreadyLocked(
    galleryId: number,
    user: UserEntity,
  ) {
    const gallery = await this.galleryRepository
      .createQueryBuilder('gallery')
      .leftJoinAndSelect('gallery.product', 'product')
      .where({ id: galleryId })
      .getOne();

    if (!gallery) {
      this.error.unprocessableEntity(['گالری محصول مورد نظر یافت نشد']);
    }

    const cleanup = await this.performGalleryDbDelete(gallery);
    await this.removeGalleryFiles(cleanup.pathFile, cleanup.type);
    return true;
  }

  async deleteGallery(galleryId: number, user: UserEntity) {
    const gallery = await this.galleryRepository
      .createQueryBuilder('gallery')
      .leftJoinAndSelect('gallery.product', 'product')
      .where({ id: galleryId })
      .getOne();

    if (!gallery) {
      this.error.unprocessableEntity(['گالری محصول مورد نظر یافت نشد']);
    }

    if (gallery.productId) {
      let cleanup: { pathFile: string; type: ProductGalleryType } | null = null;
      await this.productChildMutationLockService.withProductChildLock(
        gallery.productId,
        async () => {
          const reloaded = await this.galleryRepository
            .createQueryBuilder('gallery')
            .leftJoinAndSelect('gallery.product', 'product')
            .where({ id: galleryId })
            .getOne();
          if (!reloaded) {
            this.error.unprocessableEntity(['گالری محصول مورد نظر یافت نشد']);
          }
          cleanup = await this.performGalleryDbDelete(reloaded);
        },
      );
      if (cleanup) {
        await this.removeGalleryFiles(cleanup.pathFile, cleanup.type);
      }
      return true;
    }

    const cleanup = await this.performGalleryDbDelete(gallery);
    await this.removeGalleryFiles(cleanup.pathFile, cleanup.type);
    return true;
  }

  /**
   * -------------------------------------------------------
   */
  async findByIds(productIds: number[]) {
    for (const productId of productIds) {
      await this.getProductIdByCrawler(productId, false);
    }

    const tryToToman = await this.settingService.getTryToToman();

    const products = await this.productRepository
      .createQueryBuilder('product')

      // Product incredible offers
      .leftJoin(
        'product.incredibleOffers',
        'productIncredibleOffers',
        'productIncredibleOffers.fromDate <= :now AND productIncredibleOffers.toDate >= :now AND productIncredibleOffers.productAttributeValueId IS NULL',
        { now: new Date() },
      )
      .addSelect('productIncredibleOffers.id')
      .addSelect('productIncredibleOffers.discountedPrice')

      .leftJoinAndSelect(
        'product.productAttributeValues',
        'productAttributeValues',
        'productAttributeValues.isDeleted = 0',
      )

      // Product incredible offers for attributes
      .leftJoin(
        'productAttributeValues.incredibleOffers',
        'productAttributeIncredibleOffers',
        'productAttributeIncredibleOffers.fromDate <= :now AND productAttributeIncredibleOffers.toDate >= :now',
        { now: new Date() },
      )
      .addSelect('productAttributeIncredibleOffers.id')
      .addSelect('productAttributeIncredibleOffers.discountedPrice')

      .where('product.id IN (:...productIds) ', { productIds })
      .andWhere({ isDeleted: false })
      .andWhere('product.categoryId != 1')
      .getMany();

    return products.map((product) => ({
      ...product,

      price: tryToToman * product.price,
      discountedPrice:
        tryToToman *
        (product.incredibleOffers?.[0]?.discountedPrice ||
          product.discountedPrice),

      productAttributeValues: product.productAttributeValues.map((pav) => ({
        ...pav,
        price: tryToToman * pav.price,
        discountedPrice:
          tryToToman *
          (pav.incredibleOffers?.[0]?.discountedPrice || pav.discountedPrice),
      })),
    }));
  }

  /**
   * -------------------------------------------------------
   * PUT /products/sort/admin
   */
  async sort(dto: ProductSortDto, user: UserEntity, filters = null) {
    const conditions: any = {};
    if (dto.action) {
      conditions.id = dto.id;
    } else {
      conditions.number = dto.id;
    }

    const original = await this.productRepository
      .createQueryBuilder('product')
      .andWhere({ ...conditions })
      .getOne();

    if (!original) {
      return this.error.unprocessableEntity(['محصول مورد نظر یافت نشد']);
    }

    let builder = this.productRepository
      .createQueryBuilder('product')
      .innerJoinAndSelect('product.category', 'category')
      .select(['product.id', 'product.number', 'product.displayOrder'])
      .andWhere({ isDeleted: false });

    if (dto.action) {
      builder = applyFiltersToBuilder(builder, filters);

      if (dto.action === 'up') {
        builder = builder
          .andWhere('product.displayOrder < :displayOrder', {
            displayOrder: original.displayOrder,
          })
          .orderBy('product.displayOrder', 'DESC');
      } else {
        builder = builder
          .andWhere('product.displayOrder > :displayOrder', {
            displayOrder: original.displayOrder,
          })
          .orderBy('product.displayOrder', 'ASC');
      }
    } else {
      builder.andWhere({ number: dto.alternate });
    }

    const alternate = await builder.getOne();

    if (!alternate) {
      return this.error.unprocessableEntity(['محصول جایگزینی یافت نشد']);
    }

    const tempDisplayOrder = original.displayOrder;

    await this.productRepository
      .createQueryBuilder()
      .update()
      .set({
        displayOrder: alternate.displayOrder,
      })
      .where({ id: original.id })
      .execute();

    await this.productRepository
      .createQueryBuilder()
      .update()
      .set({ displayOrder: tempDisplayOrder })
      .where({ id: alternate.id })
      .execute();

    return true;
  }

  /**
   * -------------------------------------------------------
   */
  private async _isValidCreateNewAttributeValue(
    productId: number,
    attributeValueId: number,
  ) {
    const attributeValue = await this.attributeService.getRecordById(
      attributeValueId,
    );

    const list = await this.productAttributeValueRepository
      .createQueryBuilder('productAttributeValue')
      .innerJoin('productAttributeValue.attributeValue', 'attributeValue')
      .innerJoin('attributeValue.attribute', 'attribute')
      .andWhere({ productId, isDeleted: false })
      .groupBy('attribute.id')
      .select('COUNT(attribute.id) as maxUniqueAttributeCount')
      .addSelect('attribute.id as attributeId')
      .orderBy('maxUniqueAttributeCount', 'DESC')
      .getRawMany();

    const foundSelf = list.find(
      (item) => item.attributeId === attributeValue.attributeId,
    );
    if (!foundSelf) {
      return true;
    }

    if (list[0].attributeId === attributeValue.attributeId) {
      return true;
    }

    return +(list[0]?.maxUniqueAttributeCount || '0') < 2;
  }

  /**
   * -------------------------------------------------------
   */
  async updateQuantity(productId: number, newQuantity: number) {
    return await this.productRepository
      .createQueryBuilder()
      .update()
      .set({ quantity: newQuantity })
      .where({ id: productId })
      .execute();
  }

  /**
   * -------------------------------------------------------
   */
  async getMinMaxPricesForFilter(filters, gender) {
    let builder = this.productRepository
      .createQueryBuilder('product')
      .select([
        'MIN(COALESCE(productAttributeValues.discountedPrice, productAttributeValues.price, product.discountedPrice, product.price)) AS minPrice',
        'MAX(COALESCE(productAttributeValues.discountedPrice, productAttributeValues.price, product.discountedPrice, product.price)) AS maxPrice',
      ])
      .innerJoin('product.category', 'category', 'category.status = :status', {
        status: CategoryStatus.active,
      })
      .leftJoin(
        'product.productAttributeValues',
        'productAttributeValues',
        'productAttributeValues.isDeleted = 0',
      )
      .andWhere({ isDeleted: false })
      .andWhere('product.categoryId != 1')
      .andWhere({ status: ProductStatus.active });

    if (filters[0]?.data[0]?.value || gender[0]?.data[0]?.value) {
      if (filters[0].data[0].value !== 2) {
        builder = applyFiltersToBuilder(builder, filters);
      } else {
        builder = applyFiltersToBuilder(builder, gender);
      }
    }
    const prices = await builder.getRawOne();

    const tryToToman = await this.settingService.getTryToToman();

    return {
      minPrice: Math.round(prices.minPrice * tryToToman),
      maxPrice: Math.round(prices.maxPrice * tryToToman),
    };
  }
  /**
   * -------------------------------------------------------
   */
  async getAttributesForFilter(categoryId) {
    return await this.attributeService.getAttributesForFilter({ categoryId });
  }

  /**
   * -------------------------------------------------------
   */
  async getColorsFilter(filters) {
    let builder = this.productRepository
      .createQueryBuilder('product')
      .innerJoin('product.category', 'category', 'category.status = :status', {
        status: CategoryStatus.active,
      })
      .innerJoin('product.productAttributeValues', 'productAttributeValues')
      .innerJoin('productAttributeValues.attributeValue', 'attributeValue')
      .innerJoin(
        'attributeValue.attribute',
        'attribute',
        'attribute.type = :type',
        { type: AttributeTypes.color },
      )
      .select(['DISTINCT attributeValue.extraValue AS color'])
      .andWhere({ isDeleted: false })
      .andWhere('product.categoryId != 1')
      .andWhere({ status: ProductStatus.active });

    builder = applyFiltersToBuilder(builder, filters);
    const list = await builder.getRawMany();
    return list.map((item) => item.color);
  }

  /**
   * -------------------------------------------------------
   */
  async updateAttributeQuantity(
    productAttributeValueId: number,
    newQuantity: number,
  ) {
    return await this.productAttributeValueRepository
      .createQueryBuilder()
      .update()
      .set({ quantity: newQuantity })
      .where({ id: productAttributeValueId })
      .execute();
  }

  /**
   * Atomically decrement product stock. Unlimited stock (quantity === -1) is a no-op.
   */
  async decrementQuantity(
    productId: number,
    decrementBy: number,
    queryRunner?: QueryRunner,
  ): Promise<boolean> {
    const manager = queryRunner?.manager ?? this.productRepository.manager;

    const result = await manager
      .createQueryBuilder()
      .update(ProductEntity)
      .set({ quantity: () => 'quantity - :decrementBy' })
      .where('id = :id AND quantity >= :decrementBy')
      .setParameters({ id: productId, decrementBy })
      .execute();

    if (result.affected > 0) {
      return true;
    }

    const product = await manager.findOne(ProductEntity, {
      where: { id: productId },
      select: ['quantity'],
    });

    return product?.quantity === -1;
  }

  /**
   * Atomically decrement variant stock. Unlimited stock (quantity === -1) is a no-op.
   */
  async decrementAttributeQuantity(
    productAttributeValueId: number,
    decrementBy: number,
    queryRunner?: QueryRunner,
  ): Promise<boolean> {
    const manager =
      queryRunner?.manager ?? this.productAttributeValueRepository.manager;

    const result = await manager
      .createQueryBuilder()
      .update(ProductAttributeValueEntity)
      .set({ quantity: () => 'quantity - :decrementBy' })
      .where('id = :id AND quantity >= :decrementBy')
      .setParameters({ id: productAttributeValueId, decrementBy })
      .execute();

    if (result.affected > 0) {
      return true;
    }

    const attributeValue = await manager.findOne(ProductAttributeValueEntity, {
      where: { id: productAttributeValueId },
      select: ['quantity'],
    });

    return attributeValue?.quantity === -1;
  }

  /**
   * Atomically restore product stock inside a transaction.
   */
  async incrementQuantity(
    productId: number,
    incrementBy: number,
    queryRunner?: QueryRunner,
  ): Promise<void> {
    const manager = queryRunner?.manager ?? this.productRepository.manager;

    await manager
      .createQueryBuilder()
      .update(ProductEntity)
      .set({ quantity: () => 'quantity + :incrementBy' })
      .where('id = :id AND quantity != -1')
      .setParameters({ id: productId, incrementBy })
      .execute();
  }

  /**
   * Atomically restore variant stock inside a transaction.
   */
  async incrementAttributeQuantity(
    productAttributeValueId: number,
    incrementBy: number,
    queryRunner?: QueryRunner,
  ): Promise<void> {
    const manager =
      queryRunner?.manager ?? this.productAttributeValueRepository.manager;

    await manager
      .createQueryBuilder()
      .update(ProductAttributeValueEntity)
      .set({ quantity: () => 'quantity + :incrementBy' })
      .where('id = :id AND quantity != -1')
      .setParameters({ id: productAttributeValueId, incrementBy })
      .execute();
  }

  /**
   * -------------------------------------------------------
   */
  private mappingProduct(item, tryToToman: number) {
    const offer = item.incredibleOffers?.[0];
    delete item.incredibleOffers;

    return {
      ...item,
      price: tryToToman * item.price,
      discountedPrice:
        tryToToman * (offer?.discountedPrice || item.discountedPrice),
      incredibleOfferExpire: [],
      productAttributeValues: [],
      // incredibleOfferExpire: offer?.toDate || null,
      // productAttributeValues: item.productAttributeValues
      //   .filter(
      //     (attr) =>
      //       !!attr.attributeValue?.attribute?.id &&
      //       !!attr.attributeValue?.extraValue,
      //   )
      //   .map((attr) => ({
      //     id: attr.id,
      //     color: attr.attributeValue?.extraValue || null,
      //     price: tryToToman * attr.price,
      //     discountedPrice:
      //       tryToToman *
      //       (attr.incredibleOffers?.[0]?.discountedPrice ||
      //         attr.discountedPrice),
      //     quantity: item.quantity,
      //     incredibleOfferExpire: attr.incredibleOffers?.[0]?.toDate || null,
      //   })),
    };
  }

  /**
   * -------------------------------------------------------
   */
  async statistic() {
    const published = await this.productRepository.count({
      status: ProductStatus.active,
      isDeleted: false,
    });

    return {
      published,
    };
  }

  /**
   * -------------------------------------------------------
   */
  async getByNumber(number) {
    const productAttribute = await this.productAttributeValueRepository.findOne(
      { number },
    );

    if (productAttribute) {
      return {
        productAttributeValueId: productAttribute.id,
        productId: productAttribute.productId,
      };
    }

    const product = await this.productRepository.findOne({
      number,
      isDeleted: false,
    });

    if (product) {
      return {
        productId: product.id,
        productAttributeValueId: null,
      };
    }

    return null;
  }

  /**
   * -------------------------------------------------------
   */
  async checkDuplicateProductNumber(
    type: 'product' | 'attribute',
    number,
    selfProductId = null,
    selfProductAttrValueId = null,
  ) {
    if (!number) return;

    const builder = this.productRepository
      .createQueryBuilder('product')
      .leftJoin(
        'product.productAttributeValues',
        'productAttributeValues',
        'productAttributeValues.isDeleted = 0',
      )
      .select([
        'product.id',
        'product.number',
        'productAttributeValues.id',
        'productAttributeValues.number',
      ]);

    builder
      .andWhere(
        '(product.number = :number OR productAttributeValues.number = :number)',
        { number },
      )
      .andWhere({ isDeleted: false });

    const product = await builder.getOne();
    if (!product) return true;

    const foundAttr = product.productAttributeValues.find(
      (pav) => pav.number === number,
    );

    // For product
    if (type === 'product') {
      if (
        (product.number === number || foundAttr) &&
        ((selfProductId && selfProductId !== product.id) || !selfProductId)
      ) {
        this.error.unprocessableEntity([
          'این کد محصول قبلا برای محصول دیگری استفاده شده است',
        ]);
      }
    }
    // For attribute
    else {
      if (product.number === number && selfProductId !== product.id) {
        this.error.unprocessableEntity([
          'این کد محصول قبلا برای محصول دیگری استفاده شده است',
        ]);
      } else if (
        foundAttr &&
        ((selfProductAttrValueId && foundAttr.id !== selfProductAttrValueId) ||
          !selfProductAttrValueId)
      ) {
        this.error.unprocessableEntity([
          'این کد محصول قبلا برای محصول دیگری استفاده شده است',
        ]);
      }
    }
  }

  /**
   * -------------------------------------------------------
   */
  async getProductsPagesByCrawler() {
    this.error.methodNotAllowed([
      'این مسیر دیگر پشتیبانی نمی‌شود. ایجاد محصول بازار از API غیرفعال شده است؛ از سرویس Crawler با Phase 1C identity استفاده کنید.',
    ]);
  }

  /**
   * -------------------------------------------------------
   */
  async getProductsDetailsByCrawler() {
    for (let i = 1; i <= 100; i++) {
      const existingProduct = await this.productRepository
        .createQueryBuilder('product')
        .leftJoin('product.productGalleries', 'productGalleries')
        .leftJoin('product.productDescriptions', 'productDescriptions')
        .leftJoin('product.productAttributeValues', 'productAttributeValues')
        .leftJoin('productAttributeValues.attributeValue', 'attributeValue')
        .addSelect([
          'productGalleries.id',
          'productGalleries.pathFile',
          'productDescriptions.id',
          'productDescriptions.sourceContent',
          'productAttributeValues.id',
          'productAttributeValues.attributeValueId',
          'attributeValue.id',
          'attributeValue.sourceId',
        ])
        .where({ source: 'trendyol', isDeleted: false })
        .andWhere('product.categoryId = 1')
        .andWhere('product.sourceId IS NOT NULL')
        .orderBy('RAND()')
        .getOne();

      if (!existingProduct) break;

      try {
        await this.getProductByCrawler(existingProduct);
      } catch (e) {
        console.log(e);
      }
      await sleep(10);
    }

    return true;
  }

  /**
   * -------------------------------------------------------
   */
  async getProductIdByCrawler(id, getAfterCrawler = true) {
    const product = await this.productRepository
      .createQueryBuilder('product')
      .leftJoin('product.productGalleries', 'productGalleries')
      .leftJoin('product.productDescriptions', 'productDescriptions')
      .leftJoin('product.productAttributeValues', 'productAttributeValues')
      .leftJoin('productAttributeValues.attributeValue', 'attributeValue')
      .select([
        'product.id',
        'product.source',
        'product.name',
        'product.sourceId',
        'product.categoryId',
        'product.brandId',
        'product.color',
        'product.sourceUrl',
        'productGalleries.id',
        'productGalleries.pathFile',
        'productDescriptions.id',
        'productDescriptions.sourceContent',
        'productAttributeValues.id',
        'productAttributeValues.attributeValueId',
        'attributeValue.id',
        'attributeValue.sourceId',
      ])
      .where({ source: 'trendyol', isDeleted: false, id })
      .andWhere(
        '(product.lastCrawlingAt < DATE_SUB(NOW(), INTERVAL 30 MINUTE) OR product.categoryId = 1)',
      )
      .getOne();

    if (!product) return null;
    await this.getProductByCrawler(product);

    if (getAfterCrawler) {
      try {
        return await this.getById(product.id);
      } catch (e) {
        return null;
      }
    }
  }

  /**
   * -------------------------------------------------------
   */
  async getProductByCrawler(product: ProductEntity) {
    try {
      return await axios.post(
        `${this.getCrawlerBaseUrl()}/product`,
        {
          product: product,
        },
        {
          headers: this.getCrawlerHeaders(),
          timeout:
            parseInt(process.env.CRAWLER_REQUEST_TIMEOUT_MS || '120000', 10) ||
            120000,
        },
      );
    } catch (error) {
      console.log('Error in getProductByCrawler:', product.sourceId);
      if (String(error).includes('400')) {
        this.error.unprocessableEntity(['محصول مورد نظر یافت نشد']);
      }
    }
  }

  // async getProductByCrawler(product: ProductEntity) {
  //   const crawlerProduct = await this.crawlerService.getProductById(
  //     product.sourceId,
  //   );
  //   if (!crawlerProduct) {
  //     await this.productRepository
  //       .createQueryBuilder()
  //       .update()
  //       .set({ lastCrawlingAt: new Date(), isDeleted: true })
  //       .where({ id: product.id })
  //       .execute();
  //     return;
  //   }

  //   // Update or insert brand if missing --------------------------------------
  //   if (!product.brandId && crawlerProduct.brandId) {
  //     product.brandId = await this.brandService.addOrUpdate(
  //       product.source,
  //       crawlerProduct.brandId,
  //       { sourceName: (crawlerProduct.brandName || '').slice(0, 128) },
  //     );
  //   }

  //   // Update or insert category if missing --------------------------------------
  //   if (product.categoryId === 1 && crawlerProduct.categoryId) {
  //     product.categoryId = await this.categoryService.addOrUpdate(
  //       product.source,
  //       crawlerProduct.categoryId,
  //       {
  //         sourceName: (crawlerProduct.categoryName || '').slice(0, 128),
  //         bankTypeId: crawlerProduct.categoryBankTypeId,
  //         bankTypeName: crawlerProduct.categoryBankTypeName,
  //         hierarchy: crawlerProduct.categoryHierarchy,
  //       },
  //       crawlerProduct.categoryTree,
  //     );
  //   }

  //   // Synchronize images based on pathFile --------------------------------------
  //   const existingImagePaths = new Set(
  //     product.productGalleries.map((img) => img.pathFile),
  //   );
  //   // const newImagePaths = new Set(crawlerProduct.images);

  //   // Identify images to add and remove
  //   const imagesToAdd = crawlerProduct.images
  //     .filter((pathFile) => !existingImagePaths.has(pathFile))
  //     .map((pathFile) => ({
  //       productId: product.id,
  //       pathFile,
  //       source: product.source,
  //       createdAt: new Date(),
  //     }));

  //   // const imagesToRemove = product.productGalleries
  //   //   .filter((img) => !newImagePaths.has(img.pathFile))
  //   //   .map((img) => img.id);

  //   // Apply changes
  //   // if (imagesToRemove.length > 0) {
  //   //   await this.galleryRepository.delete(imagesToRemove);
  //   // }
  //   if (imagesToAdd.length > 0) {
  //     await this.galleryRepository.save(imagesToAdd);
  //   }

  //   // Synchronize descriptions --------------------------------------
  //   const existingDescriptionContents = new Set(
  //     product.productDescriptions.map((desc) => desc.sourceContent),
  //   );
  //   const newDescriptionContents = new Set(
  //     crawlerProduct.descriptions.map((desc) => desc.content),
  //   );

  //   // Identify descriptions to add and remove
  //   const descriptionsToAdd = [];
  //   const filteredDescriptions = crawlerProduct.descriptions.filter(
  //     (desc) => !existingDescriptionContents.has(desc.content),
  //   );

  //   const descriptionTranslateds = await this._findOrTranslateDescriptions(
  //     filteredDescriptions.map((desc) => desc.content),
  //   );

  //   let index = 0;
  //   for (const desc of filteredDescriptions) {
  //     descriptionsToAdd.push({
  //       productId: product.id,
  //       source: product.source,
  //       sourceContent: desc.content,
  //       content: descriptionTranslateds[index++],
  //       displayOrder: desc.displayOrder,
  //     });
  //   }

  //   const descriptionsToRemove = product.productDescriptions
  //     .filter((desc) => !newDescriptionContents.has(desc.sourceContent))
  //     .map((desc) => desc.id);

  //   // Apply changes
  //   if (descriptionsToRemove.length > 0) {
  //     await this.descriptionRepository.delete(descriptionsToRemove);
  //   }
  //   if (descriptionsToAdd.length > 0) {
  //     await this.descriptionRepository.save(descriptionsToAdd);
  //   }

  //   // Synchronize attributes --------------------------------------
  //   const attributeValues = await this.attributeService.addOrUpdates(
  //     crawlerProduct.attributes,
  //     product.source,
  //   );

  //   const existingAttributeIds = new Set(
  //     product.productAttributeValues.map((attr) => attr.attributeValueId),
  //   );
  //   const newAttributeIds = new Set(
  //     attributeValues.map((attr) => attr.valueId),
  //   );

  //   // Identify attributes to add and remove
  //   const attributesToAdd = attributeValues
  //     .filter((attr) => !existingAttributeIds.has(attr.valueId))
  //     .map((attr) => ({
  //       productId: product.id,
  //       source: product.source,
  //       attributeValueId: attr.valueId,
  //       discountedPrice: attr.discountedPrice,
  //       discountPercent: attr.discountPercent,
  //       price: attr.price,
  //       quantity: attr.quantity,
  //     }));
  //   const attributesToRemove = product.productAttributeValues
  //     .filter((attr) => !newAttributeIds.has(attr.attributeValueId))
  //     .map((attr) => attr.id);

  //   // Apply changes
  //   if (attributesToRemove.length > 0) {
  //     await this.productAttributeValueRepository.update(
  //       { id: In(attributesToRemove) },
  //       { isDeleted: true },
  //     );
  //   }
  //   if (attributesToAdd.length > 0) {
  //     await this.productAttributeValueRepository.save(attributesToAdd);
  //   }

  //   // Update product details --------------------------------------
  //   if (
  //     !product.name ||
  //     (product.name && !/[\u0600-\u06FF]/.test(product.name))
  //   ) {
  //     product.name = await this._findOrTranslateProduct(
  //       crawlerProduct.sourceName,
  //     );
  //   }

  //   const result = await this.productRepository
  //     .createQueryBuilder()
  //     .update()
  //     .set({
  //       brandId: product.brandId,
  //       categoryId: product.categoryId,
  //       sourceName: crawlerProduct.sourceName,
  //       name: product.name,
  //       price: crawlerProduct.price,
  //       discountedPrice: crawlerProduct.discountedPrice,
  //       discountPercent: crawlerProduct.discountedPrice
  //         ? (1 - crawlerProduct.discountedPrice / crawlerProduct.price) * 100
  //         : 0,
  //       sizeChartUrl: crawlerProduct.sizeChartUrl,
  //       color: product.color || crawlerProduct.color,
  //       star: crawlerProduct.star,
  //       starCountPerson: crawlerProduct.starCountPerson,
  //       favoriteCount: crawlerProduct.favoriteCount,
  //       isVasEnabled: crawlerProduct.isVasEnabled,
  //       tax: crawlerProduct.tax,
  //       isSellable: crawlerProduct.isSellable,
  //       isBasketDiscount: crawlerProduct.isBasketDiscount,
  //       hasStock: crawlerProduct.hasStock,
  //       isFreeCargo: crawlerProduct.isFreeCargo,
  //       uxLayout: crawlerProduct.uxLayout,
  //       isDigitalGood: crawlerProduct.isDigitalGood,
  //       isArtWork: crawlerProduct.isArtWork,
  //       gender: crawlerProduct.gender,
  //       status: ProductStatus.active,
  //       lastCrawlingAt: new Date(),
  //     })
  //     .where({ id: product.id })
  //     .execute();

  //   if (result.affected && result.affected > 0) {
  //     console.log('Row updated successfully', { id: product.id });
  //   } else {
  //     console.log('No rows were updated.', { id: product.id });
  //   }
  // }

  /**
   * -------------------------------------------------------
   */
  async getProductSourceIdByCrawler(sourceId) {
    const crawledProduct = await this.crawlerService.getProductById(sourceId);
    return crawledProduct;
  }

  /**
   * -------------------------------------------------------
   * POST /products/import/excel/admin
   */
  async importExcel(
    file: Express.Multer.File,
    dto: ProductImportExcelDto,
    user: UserEntity,
  ) {
    const workbook = xlsx.readFile(file.path);

    const sheet_name = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheet_name];

    const range = 'A1:K1000000';
    const data = xlsx.utils.sheet_to_json(sheet, { range, defval: null });

    let lastProductId;
    let lastProductName;

    const results = [];

    let lastDisplayOrder = await getLastDisplayOrder(ProductEntity.name);

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const [
        number,
        productName,
        categoryName,
        price,
        discountedPrice,
        unit, // don't remove me
        quantity,
        description,
        attributeName,
        attributeValue,
      ]: any = Object.values(row);

      try {
        const categoryId = await this.categoryService.getRecordByName(
          categoryName,
        );

        if (!categoryId) {
          results.push({
            index: i,
            number,
            name: productName,
            success: false,
            message: 'دسته بندی مورد نظر یافت نشد',
          });
          continue;
        }

        if (productName !== lastProductName) {
          let foundProduct;

          // Finding the product by product number field
          if (number) {
            foundProduct = await this.productRepository.findOne({
              number,
            });
          }
          // Finding the product by product name field, if the product number is not exist
          // else {
          //   const foundProductLocale = await this.productLocaleRepository
          //     .createQueryBuilder('productLocale')
          //     .where('TRIM(LOWER(productLocale.name)) = :name', {
          //       name: `${productName}`.toLowerCase().trim(),
          //     })
          //     .andWhere('productLocale.language = :lang', { lang: i18n.lang })
          //     .innerJoinAndSelect(
          //       'productLocale.product',
          //       'product',
          //       'product.companyId = :companyId',
          //       { companyId: user.companyId },
          //     )
          //     .getOne();

          //   foundProduct = foundProductLocale?.product || null;
          // }

          // Product found, so should be updated
          if (foundProduct) {
            lastProductId = foundProduct.id;
            lastProductName = productName;

            foundProduct.categoryId = categoryId;
            foundProduct.price = price;
            foundProduct.discountedPrice = discountedPrice || null;
            foundProduct.quantity = quantity || -1;
            foundProduct.updatedAt = new Date();
            await foundProduct.save();

            results.push({
              index: i,
              number,
              name: productName,
              success: true,
              message: ['محصول مورد نظر با موفقیت آپدیت شد'],
            });
          }
          // Product does not found, so should be added
          else {
            const { identifiers } = await this.productRepository
              .createQueryBuilder()
              .insert()
              .values({
                categoryId,
                number: number || null,
                price,
                discountedPrice: discountedPrice || null,
                quantity: quantity || -1,
                status: ProductStatus.active,
                displayOrder: lastDisplayOrder++,
                createdAt: new Date(),
              })
              .execute();

            lastProductId = identifiers[0].id;
            lastProductName = productName;

            results.push({
              index: i,
              number,
              name: productName,
              success: true,
              message: ['محصول جدید با موفقیت ایجاد شد'],
            });
          }

          // Adding the product photo
          await this._importExcelPhoto(number, dto.photos, lastProductId);

          // Adding the product attribute
          if (attributeName) {
            await this._importExcelAttribute(
              lastProductId,
              attributeName,
              attributeValue,
              {
                name: productName,
                description,
                number: number || null,
                price: price || null,
                discountedPrice: discountedPrice || null,
                quantity: quantity || -1,
              },
              results,
            );
          }
        } else {
          // Adding the product attribute for the last excel record
          await this._importExcelAttribute(
            lastProductId,
            attributeName,
            attributeValue,
            {
              name: productName,
              description,
              number: number || null,
              price: price || null,
              discountedPrice: discountedPrice || null,
              quantity: quantity || -1,
            },
            results,
          );

          // Adding the product photo for the last excel record
          await this._importExcelPhoto(number, dto.photos, lastProductId);
        }
      } catch (e) {
        console.log(e);

        results.push({
          index: i,
          number,
          name: productName,
          success: false,
          message: ['خطای غیرمنتظره ای رخ داده است'],
        });
      }
    }

    // delete the photos without productId
    for (const photo of dto.photos) {
      if (photo.isAdded) continue;

      const foundPhoto = await this.galleryRepository.findOne({
        where: {
          id: photo.galleryId,
          productId: IsNull(),
        },
      });
      if (!foundPhoto) continue;
      try {
        await fs.promises.unlink(
          path.join(__dirname, '../../..', 'uploads', foundPhoto.pathFile),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          throw error;
        }
      }

      await foundPhoto.remove();
    }

    try {
      await fs.promises.unlink(file.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw error;
      }
    }

    return results;
  }

  /**
   * -------------------------------------------------------
   */
  private async _importExcelAttribute(
    productId,
    attributeName,
    attributeValue,
    fields: any = {},
    results,
  ) {
    return this.productChildMutationLockService.withProductChildLock(
      productId,
      async () => {
        const product = await this.productRepository.findOne({
          where: { id: productId },
          select: ['id', 'isDeleted'],
        });
        assertProductEligibleForChildMutation(product, this.error);

        const attributeValueId = await this.attributeService.getRecordByName(
          attributeName,
          attributeValue,
        );

        if (!attributeValueId) {
          results.push({
            number: fields.number,
            name: fields.name,
            attributeName,
            attributeValue,
            success: false,
            message: 'ویژگی مورد نظر یافت نشد',
          });
          return;
        }

        const referencedPavIds = await loadOrderReferencedPavIds(
          this.productAttributeValueRepository.manager,
          productId,
        );

        const existingForValue =
          await this.productAttributeValueRepository.find({
            where: { productId, attributeValueId },
          });

        const canonical = selectCanonicalActivePav(
          existingForValue,
          referencedPavIds,
        ) as ProductAttributeValueEntity | null;

        if (canonical) {
          canonical.attributeValueId = attributeValueId;
          canonical.price = fields.price || null;
          canonical.discountedPrice = fields.discountedPrice || null;
          canonical.quantity = fields.quantity || -1;
          if (fields.number) {
            canonical.number = `${fields.number}`.trim();
          }
          await canonical.save();

          results.push({
            number: fields.number,
            name: fields.name,
            attributeName,
            attributeValue,
            success: true,
            message: 'ویژگی با موفقیت به روز شد',
          });
          return;
        }

        const foundByNumber = fields.number
          ? await this.productAttributeValueRepository.findOne({
              number: `${fields.number}`.trim(),
              isDeleted: false,
            })
          : null;

        if (foundByNumber && foundByNumber.productId === productId) {
          foundByNumber.attributeValueId = attributeValueId;
          foundByNumber.price = fields.price || null;
          foundByNumber.discountedPrice = fields.discountedPrice || null;
          foundByNumber.quantity = fields.quantity || -1;
          await foundByNumber.save();
          results.push({
            number: fields.number,
            name: fields.name,
            attributeName,
            attributeValue,
            success: true,
            message: 'ویژگی با موفقیت به روز شد',
          });
          return;
        }

        await this.productAttributeValueRepository
          .createQueryBuilder()
          .insert()
          .values({
            ...fields,
            productId,
            attributeValueId,
            isDeleted: false,
          })
          .execute();

        results.push({
          number: fields.number,
          name: fields.name,
          attributeName,
          attributeValue,
          success: true,
          message: ['ویژگی با موفقیت ایجاد شد'],
        });
      },
    );
  }

  /**
   * -------------------------------------------------------
   */
  private async _importExcelPhoto(number, photos, productId) {
    if (!number || !productId) return;

    return this.productChildMutationLockService.withProductChildLock(
      productId,
      async () => {
        const product = await this.productRepository.findOne(productId, {
          relations: ['productGalleries'],
        });
        assertProductEligibleForChildMutation(product, this.error);
        let hasCover = product?.coverId ? true : false;

        const existingKeys = new Set(
          (product?.productGalleries || []).map((g) =>
            galleryLogicalKey(productId, g.pathFile),
          ),
        );

        // linking the product to photos
        for (const photo of photos.filter((p) => !p.isAdded)) {
          if (
            photo.originalPhotoName.split('.')?.[0]?.split(' ')?.[0] ===
            `${number}`
          ) {
            const galleryRow = await this.galleryRepository.findOne({
              where: { id: photo.galleryId, productId: IsNull() },
            });
            if (!galleryRow) continue;

            const logicalKey = galleryLogicalKey(
              productId,
              galleryRow.pathFile,
            );
            if (existingKeys.has(logicalKey)) {
              photo.isAdded = true;
              continue;
            }

            await this.galleryRepository
              .createQueryBuilder()
              .update()
              .set({ productId })
              .where({
                id: photo.galleryId,
                productId: IsNull(),
              })
              .execute();

            existingKeys.add(logicalKey);
            photo.isAdded = true;

            // linking the photo cover (first photo) to product
            if (!hasCover) {
              product.coverId = photo.galleryId;
              await product.save();

              hasCover = true;
            }
          }
        }
      },
    );
  }

  /**
   * -------------------------------------------------------
   */
  private async _findOrTranslateProduct(sourceName) {
    const candidates = await this.productRepository
      .createQueryBuilder('product')
      .select(['product.id', 'product.name'])
      .where('product.sourceName = :sourceName', { sourceName })
      .orderBy('product.id', 'ASC')
      .take(20)
      .getMany();

    const exist = candidates.find((row) => containsPersianScript(row.name));
    if (exist?.name) {
      return exist.name;
    }

    return (await this.translatorService.text(sourceName)) || sourceName;
  }

  /**
   * -------------------------------------------------------
   */
  private async _findOrTranslateDescriptions(sourceContents) {
    if (!sourceContents.length) return [];

    const existing = await this.descriptionRepository
      .createQueryBuilder('description')
      .select(['description.sourceContent', 'description.content'])
      .where('description.sourceContent IN (:...sourceContents)', {
        sourceContents,
      })
      .take(200)
      .getMany();

    const existingMap = new Map<string, string>();
    for (const item of existing) {
      if (
        item.sourceContent &&
        item.content &&
        containsPersianScript(item.content)
      ) {
        existingMap.set(item.sourceContent, item.content);
      }
    }

    const untranslated: string[] = [];
    const result: string[] = [];

    for (const content of sourceContents) {
      if (existingMap.has(content)) {
        const translated = existingMap.get(content);
        if (translated) {
          result.push(translated);
        } else {
          untranslated.push(content);
        }
      } else {
        untranslated.push(content);
      }
    }

    const translatedData = untranslated.length
      ? await this.translatorService.array(untranslated)
      : [];

    const translatedMap = new Map<string, string>();
    translatedData.forEach(({ text, translated }) => {
      translatedMap.set(text, translated);
    });

    return sourceContents.map((content) => {
      const contentTranslation = existingMap.get(content);
      if (contentTranslation) {
        return contentTranslation;
      } else {
        const translated = translatedMap.get(content);
        if (translated) {
          return translated;
        }
      }
      return content;
    });
  }

  // /**
  //  * -------------------------------------------------------
  //  */
  // async getProductsGenderByCrawler() {
  //   const existingProducts = await this.productRepository
  //     .createQueryBuilder('product')
  //     .where({ source: 'trendyol', isDeleted: false })
  //     .andWhere('product.categoryId != 1')
  //     .andWhere('product.gender IS NULL')
  //     .orderBy('product.lastCrawlingAt', 'ASC')
  //     .take(1000)
  //     .getMany();

  //   for (const product of existingProducts) {
  //     const crawlerProduct = await this.crawlerService.getProductById(
  //       product.sourceId,
  //     );
  //     if (!crawlerProduct) {
  //       await this.productRepository
  //         .createQueryBuilder()
  //         .update()
  //         .set({ lastCrawlingAt: new Date(), isDeleted: true })
  //         .where({ id: product.id })
  //         .execute();
  //       continue;
  //     }

  //     if (!crawlerProduct.gender) {
  //       await this.productRepository
  //         .createQueryBuilder()
  //         .update()
  //         .set({ lastCrawlingAt: new Date() })
  //         .where({ id: product.id })
  //         .execute();
  //       continue;
  //     }

  //     await this.productRepository
  //       .createQueryBuilder()
  //       .update()
  //       .set({ gender: crawlerProduct.gender, lastCrawlingAt: new Date() })
  //       .where({ id: product.id })
  //       .execute();

  //     await sleep(500);
  //   }

  //   return true;
  // }

  // /**
  //  * -------------------------------------------------------
  //  */
  // async getProductGroupsByCralwer() {
  //   await this.crawlerService.getProductGroups();
  // }

  /**
   * -------------------------------------------------------
   */
  // async getProductsByCrawler() {
  //   const results = [];

  //   for (const groupId of GROUP_IDS.reverse()) {
  //     const crawledProducts = await this.crawlerService.getProducts(groupId);

  //     const existingProducts = await this.productRepository.find({
  //       where: { source: 'trendyol' },
  //       relations: ['productGalleries'],
  //     });

  //     for (const product of crawledProducts) {
  //       console.log('CRAWLER source product id', product.sourceId);

  //       const existingProduct = existingProducts.find(
  //         (p) => p.sourceId == product.sourceId,
  //       );

  //       if (existingProduct) {
  //         continue;

  //         // if (product.coverPath) {
  //         //   const existCover = existingProduct.productGalleries.find(
  //         //     (pg) => pg.pathFile === product.coverPath,
  //         //   );

  //         //   if (!existCover) {
  //         //     const { identifiers } = await this.galleryRepository
  //         //       .createQueryBuilder()
  //         //       .insert()
  //         //       .values({
  //         //         productId: existingProduct.id,
  //         //         type: ProductGalleryType.photo,
  //         //         source: existingProduct.source,
  //         //         pathFile: product.coverPath,
  //         //         createdAt: new Date(),
  //         //       })
  //         //       .execute();
  //         //     existingProduct.coverId = identifiers[0].id;
  //         //   } else {
  //         //     existingProduct.coverId = existCover.id;
  //         //   }
  //         // }

  //         // existingProduct.sourceName = product.sourceName;
  //         // existingProduct.name = await this._findOrTranslateProduct(
  //         //   product.sourceName,
  //         // );
  //         // existingProduct.sourceUrl = product.sourceUrl;
  //         // existingProduct.price = product.price;
  //         // existingProduct.discountedPrice = product.discountedPrice;
  //         // existingProduct.currency = product.currency;
  //         // existingProduct.isDeleted = false;
  //         // existingProduct.lastCrawlingAt = new Date();

  //         // await existingProduct.save();

  //         // results.push({ action: 'updated', productId: existingProduct.id });
  //       } else {
  //         const { identifiers } = await this.productRepository
  //           .createQueryBuilder()
  //           .insert()
  //           .values({
  //             categoryId: 1,
  //             source: product.source,
  //             sourceId: product.sourceId,
  //             sourceName: product.sourceName,
  //             name: await this._findOrTranslateProduct(product.sourceName),
  //             sourceUrl: product.sourceUrl,
  //             sourceGroupId: product.sourceGroupId,
  //             price: product.price,
  //             discountedPrice: product.discountedPrice,
  //             discountPercent: 0,
  //             tax: 0,
  //             currency: product.currency,
  //             quantity: -1,
  //             star: 0,
  //             starCountPerson: 0,
  //             lastCrawlingAt: new Date(),
  //             createdAt: new Date(),
  //           })
  //           .execute();

  //         const productId = identifiers[0].id;

  //         if (product.coverPath) {
  //           const { identifiers } = await this.galleryRepository
  //             .createQueryBuilder()
  //             .insert()
  //             .values({
  //               productId,
  //               type: ProductGalleryType.photo,
  //               source: product.source,
  //               pathFile: product.coverPath,
  //               createdAt: new Date(),
  //             })
  //             .execute();
  //           const coverId = identifiers[0].id;

  //           await this.productRepository
  //             .createQueryBuilder()
  //             .update()
  //             .set({ coverId })
  //             .where({ id: productId })
  //             .execute();
  //         }

  //         console.log('INSERT product id', productId);
  //         results.push({ action: 'created', productId });
  //       }
  //     }

  //     await sleep(100);
  //   }

  //   return results;
  // }
  private parseTrendyolUrl(url: string) {
    const parsedUrl = new URL(url);
    const searchParams = parsedUrl.searchParams;

    const catIdFromQuery = searchParams.get('wc') || searchParams.get('c');
    const genderFromQuery = searchParams.get('wg') || searchParams.get('g');

    const pathname = parsedUrl.pathname.toLowerCase();
    const pathMatches = [...pathname.matchAll(/(?:^|[-/])([gc])(\d+)/gi)];
    const pathValues = Object.fromEntries(
      pathMatches.map((match) => [match[1].toLowerCase(), match[2]]),
    );

    const catIdFromPath = pathValues.c || null;
    const genderFromPath = pathValues.g || null;

    return {
      catId: catIdFromPath || catIdFromQuery,
      gender: genderFromPath || genderFromQuery,
    };
  }

  async getProductsByCrawler(url: string, count) {
    const { catId, gender } = this.parseTrendyolUrl(url);
    try {
      const { data } = await axios.post(
        `${this.getCrawlerBaseUrl()}/product/page`,
        {
          count,
          catId,
          gender,
        },
        {
          headers: this.getCrawlerHeaders(),
          timeout:
            parseInt(process.env.CRAWLER_REQUEST_TIMEOUT_MS || '120000', 10) ||
            120000,
        },
      );
      return data;
    } catch (error) {
      console.log('Error in getProductsByCrawler:', error);
      throw new Error('Failed to fetch products by crawler');
    }
  }

  async getProductSampleByCrawler(url: string, count) {
    const { catId, gender } = this.parseTrendyolUrl(url);
    try {
      const { data } = await axios.post(
        `${this.getCrawlerBaseUrl()}/product/sample`,
        {
          count,
          catId,
          gender,
        },
        {
          headers: this.getCrawlerHeaders(),
          timeout:
            parseInt(process.env.CRAWLER_REQUEST_TIMEOUT_MS || '120000', 10) ||
            120000,
        },
      );
      return data;
    } catch (error) {
      console.log('Error in getProductSampleByCrawler:', error);
      throw new Error('Failed to fetch product samples by crawler');
    }
  }
}
