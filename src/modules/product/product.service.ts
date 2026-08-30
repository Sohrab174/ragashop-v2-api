import { Body, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  getConnection,
  Repository,
  IsNull,
  In,
  Not,
  LessThanOrEqual,
  MoreThanOrEqual,
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
import { CategoryService } from '../category/category.service';
import { CategoryStatus } from '../category/entities/category.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductEntity, ProductStatus } from './entities/product.entity';
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
    private readonly fileStorage: FileStorageService, // @Inject(CACHE_MANAGER) private cache: Cache,
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
   * GET /products/link
   */
  async getByLink(link: string) {
    let data;
    try {
      data = await axios.post('http://127.0.0.1:9019/product/search', {
        url: link,
      });
    } catch (error) {
      console.error('Error fetching product by link:', error);
      throw error;
    }
    console.log('search endpont res:', data.data);

    return data.data;
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
            }),
        'product',
      )
      .andWhere('product.row_num <= :num', { num: limitPerCategory })
      .andWhere({ isDeleted: false })
      .getRawMany();

    // Not found
    if (targetProductList?.length === 0) {
      return [];
    }

    const productList = await this.productRepository
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
      .andWhere('product.categoryId != 1')

      // GPT SAYS: In general, when you use a subquery in MySQL, the subquery is executed for each row in the outer query.
      // .andWhere(
      //   (qb) => {
      //     const subQuery = qb
      //       .subQuery()
      //       .select('target_product.id')
      //       .from(
      //         (subQuery) =>
      //           subQuery
      //             .select(
      //               'p.id, ROW_NUMBER() OVER (PARTITION BY p.categoryId ORDER BY displayOrder ASC) as row_num',
      //             )
      //             .from(ProductEntity, 'p')
      //             .where('p.companyId = :companyId AND p.status = :status', {
      //               companyId,
      //               status: ProductStatus.active,
      //             }),
      //         'target_product',
      //       )
      //       .where('target_product.row_num <= :num', { num: limitPerCategory })
      //       .getQuery();
      //     return `product.id IN (${subQuery})`;
      //   },
      // { limit: limitPerCategory },
      // )

      .orderBy('product.displayOrder', 'ASC')
      .getMany();

    const tryToToman = await this.settingService.getTryToToman();

    return productList.map((item) => this.mappingProduct(item, tryToToman));
  }

  /**
   * -------------------------------------------------------
   * POST & PUT /products/attribute/admin
   */
  async addUpdateProductAttributeValue(dto: CreateUpdateProductAttrValueDto) {
    const product = await this.productRepository
      .createQueryBuilder('product')
      .andWhere({ id: dto.productId })
      .getOne();

    const attributeValue = await this.attributeService.getRecordById(
      dto.attributeValueId,
    );

    if (!product || !attributeValue) {
      this.error.unprocessableEntity(['این درخواست نامعتبر است']);
    }

    // Updating the product attribute value
    const productAttrValue = await this.productAttributeValueRepository.findOne(
      {
        productId: dto.productId,
        attributeValueId: dto.attributeValueId,
        isDeleted: false,
      },
    );

    await this.checkDuplicateProductNumber(
      'attribute',
      dto.number,
      product.id,
      productAttrValue?.id,
    );

    // Exist product attribute value
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

      await productAttrValue.save();

      return { id: productAttrValue.id };
    }

    // Creating a new product attribute value
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
        isDeleted: false,
      })
      .execute();

    const newProductAttValueId = identifiers[0].id;

    return { id: newProductAttValueId };
  }

  /**
   * -------------------------------------------------------
   * DELETE /products/attribute/:id/admin
   */
  async deleteProductAttributeValue(id: number, user: UserEntity) {
    const productAttrValue = await this.productAttributeValueRepository.findOne(
      {
        where: { id },
      },
    );

    if (!productAttrValue) {
      this.error.unprocessableEntity(['مقدار مشخصه محصول موردنظر پیدا نشد']);
    }

    productAttrValue.isDeleted = true;
    await productAttrValue.save();

    return true;
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
    }

    return { id: newProductId };
  }

  /**
   * -------------------------------------------------------
   * PUT /products/admin
   */
  async update(dto: UpdateProductDto, user: UserEntity) {
    const product = await this.productRepository.findOne({
      where: { id: dto.id },
      relations: ['productDescriptions'],
    });

    if (!product) {
      this.error.unprocessableEntity(['محصول مورد نظر یافت نشد!']);
    }

    const existCategory = await this.categoryService.getRecordById(
      dto.categoryId,
    );
    if (!existCategory) {
      this.error.unprocessableEntity(['دسته بندی انتخابی معتبر نمی باشد']);
    }

    // Checking duplicate product number
    await this.checkDuplicateProductNumber('product', dto.number, product.id);

    // Updating the product
    if (dto.status !== undefined) product.status = dto.status;
    if (dto.price !== undefined) product.price = dto.price;
    if (dto.discountedPrice !== undefined)
      product.discountedPrice = dto.discountedPrice;
    if (dto.coverId !== undefined) product.coverId = dto.coverId;
    if (dto.categoryId !== undefined) product.categoryId = dto.categoryId;
    if (dto.quantity !== undefined) product.quantity = dto.quantity;
    if (dto.number !== undefined) product.number = dto.number;
    if (dto.name !== undefined) product.name = dto.name;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.gender !== undefined) product.gender = dto.gender;

    await product.save();

    if (dto.descriptions !== undefined) {
      const existDescriptionIds = dto.descriptions
        .filter((d) => !!d?.id)
        .map((d) => d.id);

      const deleteDescriptionIds = product.productDescriptions
        .filter((pd) => !existDescriptionIds.includes(pd.id))
        .map((d) => d.id);
      if (deleteDescriptionIds.length > 0) {
        await this.descriptionRepository
          .createQueryBuilder()
          .update()
          .set({ isDeleted: true })
          .where('id IN (:...ids)', { ids: deleteDescriptionIds })
          .execute();
      }

      const updateDescriptions = product.productDescriptions.filter((pd) =>
        existDescriptionIds.includes(pd.id),
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
              productId: product.id,
            })),
          )
          .execute();
      }
    }

    return true;
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
      .where({ id: In(dto.ids) })
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
    let product = null;
    if (dto.productId) {
      product = await this.productRepository
        .createQueryBuilder('product')
        .leftJoinAndSelect('product.productGalleries', 'productGalleries')
        .andWhere({ id: dto.productId })
        .getOne();

      if (!product) {
        this.error.unprocessableEntity(['محصول مورد نظر یافت نشد!']);
      }

      // Removing the prev cover before adding the new cover
      if (dto.isCover && product.coverId) {
        await this.deleteGallery(product.coverId, user);
      } else {
        if (product.productGalleries.length > 0) {
          await this.deleteGallery(product.productGalleries[0].id, user);
        }
      }
    }

    const pathFile = `/products/${file.filename}`;

    // Creating a new gallery
    const { identifiers } = await this.galleryRepository
      .createQueryBuilder()
      .insert()
      .values({
        pathFile,
        type,
        productId: dto?.productId || null,
        createdAt: new Date(),
      })
      .execute();

    const newGalleryId = identifiers[0].id;

    // generate thumbnail
    if (type === ProductGalleryType.photo) {
      await generateThumbnail(file.path);
      await optimizeImage(file.path);
    }

    // Settting cover product
    if (type === ProductGalleryType.photo && dto.isCover && product) {
      await this.productRepository
        .createQueryBuilder()
        .update()
        .set({ coverId: newGalleryId })
        .where({ id: product.id })
        .execute();
    }

    return { id: newGalleryId, pathFile, type };
  }

  /**
   * -------------------------------------------------------
   * DELETE /products/:id/admin
   */
  async delete(id: number, user: UserEntity) {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: ['productGalleries', 'productAttributeValues'],
    });

    if (!product) {
      this.error.unprocessableEntity(['محصول مورد نظر یافت نشد!']);
    }

    product.isDeleted = true;
    await product.save();

    // // Rollbacking the product locales if an error occurs
    // const queryRunner = getConnection().createQueryRunner();
    // await queryRunner.connect();
    // await queryRunner.startTransaction();

    // const oldGalleryPaths = [];
    // const oldFilePaths = [];

    // try {
    //   product.coverId = null;
    //   await queryRunner.manager.save(product);

    //   for (let i = 0; i < product.productAttributeValues.length; i++) {
    //     const productAttributeValue = product.productAttributeValues[i];
    //     // Removing the product attribute value
    //     await queryRunner.manager.remove(productAttributeValue);
    //   }

    //   for (let i = 0; i < product.productGalleries.length; i++) {
    //     const gallery = product.productGalleries[i];
    //     oldGalleryPaths.push(gallery.pathFile);
    //     // Removing the product gallery
    //     await queryRunner.manager.remove(gallery);
    //   }

    //   // Removing the product
    //   await queryRunner.manager.remove(product);

    //   await queryRunner.commitTransaction();
    // } catch (err) {
    //   await queryRunner.rollbackTransaction();

    //   this.error.methodNotAllowed([
    //     'برخی از سفارشات مربوط به این محصول هستند، لطفا ابتدا سفارشات این محصول را حذف کنید',
    //   ]);
    // } finally {
    //   await queryRunner.release();
    // }

    // oldGalleryPaths.forEach((pathFile) => {
    //   fs.unlink(path.join(__dirname, '../../..', 'uploads', pathFile), (e) =>
    //     console.log(e),
    //   );
    // });

    // oldFilePaths.forEach((pathFile) => {
    //   fs.unlink(path.join(__dirname, '../../..', 'uploads', pathFile), (e) =>
    //     console.log(e),
    //   );
    // });

    return true;
  }

  /**
   * -------------------------------------------------------
   * DELETE /products/gallery/:id/admin
   */
  async deleteGallery(galleryId: number, user: UserEntity) {
    const gallery = await this.galleryRepository
      .createQueryBuilder('gallery')
      .leftJoinAndSelect('gallery.product', 'product')
      .where({ id: galleryId })
      .getOne();

    if (!gallery) {
      this.error.unprocessableEntity(['گالری محصول مورد نظر یافت نشد']);
    }

    if (gallery.product && gallery.product.coverId === +galleryId) {
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
      .where({ id: galleryId })
      .execute();

    fs.unlink(
      path.join(__dirname, '../../..', 'uploads', gallery.pathFile),
      (e) => console.log(e),
    );

    // Removing the thumb
    if (gallery.type === ProductGalleryType.photo) {
      fs.unlink(
        path.join(
          __dirname,
          '../../..',
          'uploads',
          applyPathToThumbPath(gallery.pathFile),
        ),
        (e) => console.log(e),
      );
    }

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
    const storage = this.fileStorage.load();
    const categories = storage.trendyolCategories;
    const keys = Object.keys(categories);
    const category = keys[Math.floor(Math.random() * keys.length)];
    const page = categories[category];

    const crawledProducts = await this.crawlerService.getProductByPage(
      page,
      category,
    );

    if (crawledProducts.length === 0) return;

    for (const product of crawledProducts.filter((p) => !!p?.sourceId)) {
      const existingProduct = await this.productRepository.count({
        sourceId: product.sourceId,
        source: product.source,
      });
      if (existingProduct > 0) continue;

      const { identifiers } = await this.productRepository
        .createQueryBuilder()
        .insert()
        .values({
          categoryId: 1,
          source: product.source,
          sourceId: product.sourceId,
          sourceName: product.sourceName,
          // name: await this._findOrTranslateProduct(product.sourceName),
          name: product.sourceName,
          sourceUrl: product.sourceUrl,
          sourceGroupId: product.sourceGroupId,
          price: product.price,
          discountedPrice: product.discountedPrice,
          discountPercent: 0,
          tax: 0,
          currency: product.currency,
          quantity: -1,
          star: 0,
          starCountPerson: 0,
          lastCrawlingAt: new Date(),
          createdAt: new Date(),
        })
        .execute();

      const productId = identifiers[0].id;

      if (product.coverPath) {
        const { identifiers } = await this.galleryRepository
          .createQueryBuilder()
          .insert()
          .values({
            productId,
            type: ProductGalleryType.photo,
            source: product.source,
            pathFile: product.coverPath,
            createdAt: new Date(),
          })
          .execute();
        const coverId = identifiers[0].id;

        await this.productRepository
          .createQueryBuilder()
          .update()
          .set({ coverId })
          .where({ id: productId })
          .execute();
      }

      console.log('INSERT product id', productId);

      sleep(100);
    }

    categories[category] = +page + 1;
    this.fileStorage.save(storage);
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
      return await axios.post('http://127.0.0.1:9019/product', {
        product: product,
      });
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
      fs.unlink(
        path.join(__dirname, '../../..', 'uploads', foundPhoto.pathFile),
        (e) => console.log(e),
      );

      foundPhoto.remove();
    }

    fs.unlink(file.path, (e) => console.log(e));

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

    const foundProductAttributeValue =
      await this.productAttributeValueRepository.findOne({
        number: `${fields.number}`.trim(),
        isDeleted: false,
      });

    if (foundProductAttributeValue) {
      foundProductAttributeValue.attributeValueId = attributeValueId;
      foundProductAttributeValue.price = fields.price || null;
      foundProductAttributeValue.discountedPrice =
        fields.discountedPrice || null;
      foundProductAttributeValue.quantity = fields.quantity || -1;
      await foundProductAttributeValue.save();

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
  }

  /**
   * -------------------------------------------------------
   */
  private async _importExcelPhoto(number, photos, productId) {
    if (!number) return;

    const product = await this.productRepository.findOne(productId);
    let hasCover = product?.coverId ? true : false;

    // linking the product to photos
    for (const photo of photos.filter((p) => !p.isAdded)) {
      if (
        photo.originalPhotoName.split('.')?.[0]?.split(' ')?.[0] === `${number}`
      ) {
        await this.galleryRepository
          .createQueryBuilder()
          .update()
          .set({ productId })
          .where({
            id: photo.galleryId,
            productId: IsNull(),
          })
          .execute();

        photo.isAdded = true;

        // linking the photo cover (first photo) to product
        if (!hasCover) {
          product.coverId = photo.galleryId;
          await product.save();

          hasCover = true;
        }
      }
    }
  }

  /**
   * -------------------------------------------------------
   */
  private async _findOrTranslateProduct(sourceName) {
    const exist = await this.productRepository
      .createQueryBuilder('product')
      .select(['product.id', 'product.name'])
      .where('product.sourceName = :sourceName', { sourceName })
      .andWhere('product.name REGEXP :persianPattern', {
        persianPattern: '[\\u0600-\\u06FF]',
      })
      .getOne();

    if (exist) {
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
      .andWhere('description.content REGEXP :persianPattern', {
        persianPattern: '[\\u0600-\\u06FF]', // Persian characters
      })
      .getMany();

    const existingMap = new Map<string, string>();
    for (const item of existing) {
      existingMap.set(item.sourceContent, item.content);
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
      const { data } = await axios.post('http://127.0.0.1:9019/product/page', {
        count,
        catId,
        gender,
      });
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
        'http://127.0.0.1:9019/product/sample',
        {
          count,
          catId,
          gender,
        },
      );
      return data;
    } catch (error) {
      console.log('Error in getProductSampleByCrawler:', error);
      throw new Error('Failed to fetch product samples by crawler');
    }
  }
}
