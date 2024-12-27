import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { I18nContext } from 'nestjs-i18n';
import { getConnection, Repository, IsNull } from 'typeorm';
import { ErrorService } from '../../error/error.service';
import * as path from 'path';
import * as fs from 'fs';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  getDuplicateItems,
  paginationResult,
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

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(ProductEntity)
    private productRepository: Repository<ProductEntity>,

    @InjectRepository(ProductAttributeValueEntity)
    private productAttributeValueRepository: Repository<ProductAttributeValueEntity>,

    @InjectRepository(ProductGalleryEntity)
    private galleryRepository: Repository<ProductGalleryEntity>,

    private error: ErrorService,
    private categoryService: CategoryService,
    private attributeService: AttributeService,
  ) {}

  /**
   * -------------------------------------------------------
   * POST /products/import/excel/admin
   */
  async importExcel(
    file: Express.Multer.File,
    dto: ProductImportExcelDto,
    user: UserEntity,
  ) {
    const i18n = I18nContext.current();

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
        shortDescription,
        description,
        attributeName,
        attributeValue,
      ]: any = Object.values(row);

      try {
        const categoryId = await this.categoryService.getByNameAndCompanyId(
          categoryName,
        );

        if (!categoryId) {
          results.push({
            index: i,
            number,
            name: productName,
            success: false,
            message: i18n.t('t.The category is not found').replace(/^t\./i, ''),
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
              message: [
                i18n
                  .t('t.The product is updated successfully')
                  .replace(/^t\./i, ''),
              ],
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
              message: [
                i18n
                  .t('t.The product is created successfully')
                  .replace(/^t\./i, ''),
              ],
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
                shortDescription,
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
              shortDescription,
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
          message: [
            i18n.t('t.An unexpected error has occurred').replace(/^t\./i, ''),
          ],
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
    const i18n = I18nContext.current();

    const attributeValueId = await this.attributeService.getByNameAndCompanyId(
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
        message: i18n.t('t.The attribute is not found').replace(/^t\./i, ''),
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
        message: i18n
          .t('t.The attribute is updated successfully')
          .replace(/^t\./i, ''),
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
      message: [
        i18n.t('t.The attribute is created successfully').replace(/^t\./i, ''),
      ],
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
   * GET /products/galleries/admin
   */
  async getAllGalleries(
    page = 1,
    limit = 20,
    filters = null,
    sorts = null,
    companyId = null,
  ) {
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

    if (companyId) {
      builder.innerJoin(
        'gallery.product',
        'product',
        'product.companyId = :companyId',
        { companyId },
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
   * GET /products/admin
   */
  async getAllForAdmin(
    page = 1,
    limit = 20,
    filters = null,
    sorts = null,
    companyId = null,
    number = null,
  ) {
    const { lang } = I18nContext.current();

    let builder = this.productRepository
      .createQueryBuilder('product')
      .innerJoinAndSelect('product.category', 'category')
      .innerJoinAndSelect(
        'category.locales',
        'categoryLocales',
        'categoryLocales.language = :lang',
        { lang },
      )
      .innerJoinAndSelect(
        'product.locales',
        'locales',
        'locales.language = :lang',
        { lang },
      )
      .leftJoinAndSelect('product.cover', 'cover')
      .leftJoinAndSelect(
        'product.productAttributeValues',
        'productAttributeValues',
      );

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('product.displayOrder', 'ASC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    if (companyId) {
      builder.andWhere({ companyId });
    }

    if (number) {
      builder.andWhere(
        '(product.number LIKE :number OR productAttributeValues.number LIKE :number)',
        { number: `%${number}%` },
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
  async getAllForAdminWithAttributes(companyId = null) {
    const { lang } = I18nContext.current();

    const builder = this.productRepository
      .createQueryBuilder('product')
      .innerJoin(
        'product.locales',
        'productLocales',
        'productLocales.language = :lang',
        {
          lang,
        },
      )
      .innerJoin('product.category', 'category', 'category.status = :status', {
        status: CategoryStatus.active,
      })
      .leftJoin(
        'product.productAttributeValues',
        'productAttributeValues',
        'productAttributeValues.isDeleted = 0',
      )
      .leftJoin('productAttributeValues.attributeValue', 'attributeValue')
      .leftJoin(
        'attributeValue.locales',
        'attributeValueLocales',
        'attributeValueLocales.language = :lang',
        { lang },
      )
      .leftJoin('attributeValue.attribute', 'attribute')
      .leftJoin(
        'attribute.locales',
        'attributeLocales',
        'attributeLocales.language = :lang',
        { lang },
      )
      .select([
        'product.id',
        'product.price',
        'product.quantity',
        'product.discountedPrice',
        'productLocales.id',
        'productLocales.name',
        'productAttributeValues.id',
        'productAttributeValues.price',
        'productAttributeValues.quantity',
        'productAttributeValues.discountedPrice',
        'productAttributeValues.attributeValueId',
        'attributeValue.id',
        'attributeValue.extraValue',
        'attributeValue.secondExtraValue',
        'attributeValueLocales.id',
        'attributeValueLocales.value',
        'attribute.id',
        'attribute.type',
        'attributeLocales.id',
        'attributeLocales.name',
      ])
      .andWhere('product.status = :status', {
        product: ProductStatus.active,
      })
      .orderBy('product.displayOrder', 'ASC');

    if (companyId) {
      builder.andWhere({ companyId });
    }

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
  async getAttributesByProductId(productId: number, companyId) {
    const i18n = I18nContext.current();

    const builder = this.productAttributeValueRepository
      .createQueryBuilder('attrValue')
      .innerJoinAndSelect('attrValue.attributeValue', 'attributeValue')
      .innerJoinAndSelect(
        'attributeValue.locales',
        'attributeValueLocales',
        'attributeValueLocales.language = :lang',
        { lang: i18n.lang },
      )
      .innerJoinAndSelect('attributeValue.attribute', 'attribute')
      .innerJoinAndSelect(
        'attribute.locales',
        'attributeLocales',
        'attributeLocales.language = :lang',
        { lang: i18n.lang },
      )
      .where({ productId, companyId, isDeleted: false });

    const productAttrValues = await builder.getMany();

    if (!productAttrValues) {
      this.error.unprocessableEntity([
        i18n.t('t.The value of the product attribute not found!'),
      ]);
    }

    return productAttrValues;
  }

  /**
   * -------------------------------------------------------
   * GET /products/:id/admin
   */
  async getByIdForAdmin(id: number, companyId = null) {
    const i18n = I18nContext.current();

    const builder = this.productRepository
      .createQueryBuilder('product')
      .innerJoinAndSelect('product.locales', 'locales')
      .leftJoinAndSelect('product.cover', 'cover')
      // .leftJoinAndSelect('product.galleries', 'galleries')
      .innerJoinAndSelect('product.category', 'category')
      .innerJoinAndSelect(
        'category.locales',
        'categoryLocales',
        'categoryLocales.language = :lang',
        { lang: i18n.lang },
      )
      .where({ id });

    if (companyId) {
      builder.andWhere({ companyId });
    }

    const product = await builder.getOne();

    if (!product) {
      this.error.unprocessableEntity([i18n.t('t.The product not found!')]);
    }

    return product;
  }

  /**
   * -------------------------------------------------------
   * GET /products/:id
   */
  async getById(id: number, companyId) {
    const i18n = I18nContext.current();

    const builder = this.productRepository
      .createQueryBuilder('product')
      .innerJoinAndSelect(
        'product.locales',
        'locales',
        'locales.language = :lang',
        { lang: i18n.lang },
      )
      .leftJoinAndSelect('product.cover', 'cover')
      .leftJoinAndSelect('product.productGalleries', 'productGalleries')
      .innerJoinAndSelect('product.category', 'category')
      .innerJoinAndSelect(
        'category.locales',
        'categoryLocales',
        'categoryLocales.language = :lang',
        { lang: i18n.lang },
      )
      // Product incredible offers
      .leftJoin(
        'product.incredibleOffers',
        'productIncredibleOffers',
        'productIncredibleOffers.fromDate <= :now AND productIncredibleOffers.toDate >= :now AND productIncredibleOffers.productAttributeValueId IS NULL',
        { now: new Date() },
      )
      .addSelect('productIncredibleOffers.id')
      .addSelect('productIncredibleOffers.discountedPrice')
      .addSelect('productIncredibleOffers.toDate')

      .leftJoinAndSelect(
        'product.productAttributeValues',
        'productAttributeValues',
        'productAttributeValues.isDeleted = 0',
      )
      .leftJoinAndSelect(
        'productAttributeValues.attributeValue',
        'attributeValue',
      )
      .leftJoinAndSelect(
        'attributeValue.locales',
        'attributeValueLocales',
        'attributeValueLocales.language = :lang',
        { lang: i18n.lang },
      )
      .leftJoinAndSelect('attributeValue.attribute', 'attribute')
      .leftJoinAndSelect(
        'attribute.locales',
        'attributeLocales',
        'attributeLocales.language = :lang',
        { lang: i18n.lang },
      )
      .leftJoin('product.productFiles', 'productFiles')
      .addSelect([
        'productFiles.id',
        'productFiles.title',
        'productFiles.fileType',
        'productFiles.fileSize',
      ])

      // Product incredible offers for attributes
      .leftJoin(
        'productAttributeValues.incredibleOffers',
        'productAttributeIncredibleOffers',
        'productAttributeIncredibleOffers.fromDate <= :now AND productAttributeIncredibleOffers.toDate >= :now',
        { now: new Date() },
      )
      .addSelect('productAttributeIncredibleOffers.id')
      .addSelect('productAttributeIncredibleOffers.discountedPrice')
      .addSelect('productAttributeIncredibleOffers.toDate')

      .where({ id });

    builder.andWhere({ companyId });
    builder.andWhere({ status: ProductStatus.active });

    const product: ProductEntity & {
      incredibleOfferExpire?: Date;
      productAttributeValues: any;
    } = await builder.getOne();

    if (!product) {
      this.error.unprocessableEntity([i18n.t('t.The product not found!')]);
    }

    product.discountedPrice =
      product.incredibleOffers?.[0]?.discountedPrice || product.discountedPrice;

    product.incredibleOfferExpire =
      product.incredibleOffers?.[0]?.toDate || null;

    product.productAttributeValues = product.productAttributeValues.map(
      (pav) => {
        pav.discountedPrice =
          pav.incredibleOffers?.[0]?.discountedPrice || pav.discountedPrice;
        pav.incredibleOfferExpire = pav.incredibleOffers?.[0]?.toDate || null;
        delete pav.incredibleOffers;
        return pav;
      },
    );

    delete product.incredibleOffers;

    if (product.coverId && product.productGalleries?.length === 1) {
      return product;
    }

    return {
      ...product,
      productGalleries: product.productGalleries.filter(
        (g) => g.id !== product.coverId,
      ),
    };
  }

  /**
   * -------------------------------------------------------
   * GET /products
   */
  async getAll(
    companyId,
    page = 1,
    limit = 20,
    filters,
    sorts = null,
    priceRanges: any = {},
  ) {
    const { lang } = I18nContext.current();

    let builder = this.productRepository
      .createQueryBuilder('product')
      .innerJoin('product.category', 'category', 'category.status = :status', {
        status: CategoryStatus.active,
      })
      .innerJoinAndSelect(
        'product.locales',
        'locales',
        'locales.language = :lang',
        { lang },
      )
      .leftJoinAndSelect('product.cover', 'cover')
      .andWhere({ companyId })
      .andWhere({ status: ProductStatus.active })

      // Product incredible offers
      .leftJoin(
        'product.incredibleOffers',
        'productIncredibleOffers',
        'productIncredibleOffers.fromDate <= :now AND productIncredibleOffers.toDate >= :now AND productIncredibleOffers.productAttributeValueId IS NULL',
        { now: new Date() },
      )
      .addSelect('productIncredibleOffers.id')
      .addSelect('productIncredibleOffers.discountedPrice')
      .addSelect('productIncredibleOffers.toDate')

      // Product attribute value
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
      .addSelect('productAttributeValues.quantity')
      .addSelect('attributeValue.id')
      .addSelect('attributeValue.extraValue')
      .addSelect('attributeValue.secondExtraValue')
      .addSelect('attribute.id')

      // Product incredible offers for attributes
      .leftJoin(
        'productAttributeValues.incredibleOffers',
        'productAttributeIncredibleOffers',
        'productAttributeIncredibleOffers.fromDate <= :now AND productAttributeIncredibleOffers.toDate >= :now',
        { now: new Date() },
      )
      .addSelect('productAttributeIncredibleOffers.id')
      .addSelect('productAttributeIncredibleOffers.discountedPrice')
      .addSelect('productAttributeIncredibleOffers.toDate');

    builder.addSelect(
      `
          COALESCE(
            MIN(
              COALESCE(
                NULLIF(productAttributeValues.discountedPrice, 0),
                NULLIF(productAttributeValues.price, 0)
              )
            ) OVER (PARTITION BY product.id),
            NULLIF(product.discountedPrice, 0),
            NULLIF(product.price, 0),
            0
          ) AS mainPrice
        `,
    );
    // builder.addSelect(
    //   'COALESCE(productAttributeValues.discountedPrice, productAttributeValues.price, product.discountedPrice, product.price)',
    //   'mainPrice',
    // );

    if (sorts) {
      // Sorting by best sellers
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
      }
      // Sorting by price
      else if (sorts[0].field === 'price') {
        builder.orderBy('mainPrice', sorts[0].dir);
      }
      // Sorting by request of front
      else {
        builder = applySortingToBuilder(builder, sorts);
      }
    }
    // Sorting by display order field
    else {
      builder.orderBy('product.displayOrder', 'ASC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    // Filtering by price ranges
    if (priceRanges?.minPrice && priceRanges?.maxPrice) {
      builder.andWhere(
        `COALESCE(
            NULLIF(productAttributeValues.discountedPrice, 0),
            NULLIF(productAttributeValues.price, 0),
            NULLIF(product.discountedPrice, 0),
            NULLIF(product.price, 0),
            0
          ) BETWEEN :minPrice AND :maxPrice`,
        priceRanges,
      );
    }

    const [items, totalItems] = await builder
      .take(limit)
      .skip((page - 1) * limit)
      .getManyAndCount();

    return {
      items: items.map(this.mappingProduct),
      pagination: paginationResult(page, limit, totalItems),
    };
  }

  /**
   * -------------------------------------------------------
   * GET /products/summary
   */
  async getSummaries(companyId, limitPerCategory = 4) {
    const { lang } = I18nContext.current();

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
            .where('p.companyId = :companyId AND p.status = :status', {
              companyId,
              status: ProductStatus.active,
            }),
        'product',
      )
      .andWhere('product.row_num <= :num', { num: limitPerCategory })
      .getRawMany();

    // Not found
    if (targetProductList?.length === 0) {
      return [];
    }

    const productList = await this.productRepository
      .createQueryBuilder('product')
      .innerJoinAndSelect(
        'product.locales',
        'locales',
        'locales.language = :lang',
        { lang },
      )

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
      .addSelect('attributeValue.secondExtraValue')
      .addSelect('attribute.id')
      .andWhere({ companyId })
      .andWhere({ status: ProductStatus.active })

      .andWhere('product.id IN (:...ids)', {
        ids: targetProductList.map((p) => p.id),
      })

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

    return productList.map(this.mappingProduct);
  }

  /**
   * -------------------------------------------------------
   * POST & PUT /products/attribute/admin
   */
  async addUpdateProductAttributeValue(
    dto: CreateUpdateProductAttrValueDto,
    user: UserEntity,
  ) {
    const i18n = I18nContext.current();

    const product = await this.productRepository
      .createQueryBuilder('product')
      .innerJoinAndSelect(
        'product.locales',
        'locales',
        'locales.language = :lang',
        { lang: i18n.lang },
      )
      .andWhere({ id: dto.productId })
      .getOne();

    const attributeValue = await this.attributeService.getByIdAndCompanyId(
      dto.attributeValueId,
    );

    if (!product || !attributeValue) {
      this.error.unprocessableEntity([i18n.t('t.The request is not valid!')]);
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
        i18n.t(
          't.It is not possible to define more than one multiple attribute',
        ),
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
    const i18n = I18nContext.current();

    const productAttrValue = await this.productAttributeValueRepository.findOne(
      {
        where: { id },
      },
    );

    if (!productAttrValue) {
      this.error.unprocessableEntity([
        i18n.t('t.The value of the product attribute not found!'),
      ]);
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
    const i18n = I18nContext.current();

    const existCategory = await this.categoryService.getByIdAndCompanyId(
      dto.categoryId,
    );

    if (!existCategory) {
      this.error.unprocessableEntity([i18n.t('t.The category is not valid!')]);
    }

    // Checking duplicate product number
    await this.checkDuplicateProductNumber('product', dto.number);

    // Creating a new product
    const { identifiers } = await this.productRepository
      .createQueryBuilder()
      .insert()
      .values({
        categoryId: dto.categoryId,
        number: dto.number || null,
        quantity:
          dto.quantity === undefined || dto.quantity === null
            ? -1
            : dto.quantity,
        price: dto.price,
        discountedPrice: dto.discountedPrice || null,
        displayOrder: await getLastDisplayOrder(ProductEntity.name),
        status: dto.status,
        createdAt: new Date(),
      })
      .execute();

    const newProductId = identifiers[0].id;

    return { id: newProductId };
  }

  /**
   * -------------------------------------------------------
   * PUT /products/admin
   */
  async update(dto: UpdateProductDto, user: UserEntity) {
    const i18n = I18nContext.current();

    const product = await this.productRepository.findOne({
      where: { id: dto.id },
    });

    if (!product) {
      this.error.unprocessableEntity([i18n.t('t.The product not found!')]);
    }

    const existCategory = await this.categoryService.getByIdAndCompanyId(
      dto.categoryId,
    );
    if (!existCategory) {
      this.error.unprocessableEntity([i18n.t('t.The category is not valid!')]);
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

    await product.save();

    return true;
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
    const i18n = I18nContext.current();

    let product = null;
    if (dto.productId) {
      product = await this.productRepository
        .createQueryBuilder('product')
        .leftJoinAndSelect('product.productGalleries', 'productGalleries')
        .innerJoinAndSelect(
          'product.locales',
          'locales',
          'locales.language = :lang',
          { lang: i18n.lang },
        )
        .andWhere({ id: dto.productId })
        .getOne();

      if (!product) {
        this.error.unprocessableEntity([i18n.t('t.The product not found!')]);
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
    const i18n = I18nContext.current();

    const product = await this.productRepository.findOne({
      where: { id },
      relations: [
        'locales',
        'productGalleries',
        'productFiles',
        'productAttributeValues',
      ],
    });

    if (!product) {
      this.error.unprocessableEntity([i18n.t('t.The product not found!')]);
    }

    // Rollbacking the product locales if an error occurs
    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const oldGalleryPaths = [];
    const oldFilePaths = [];

    try {
      product.coverId = null;
      await queryRunner.manager.save(product);

      for (let i = 0; i < product.productAttributeValues.length; i++) {
        const productAttributeValue = product.productAttributeValues[i];
        // Removing the product attribute value
        await queryRunner.manager.remove(productAttributeValue);
      }

      for (let i = 0; i < product.productGalleries.length; i++) {
        const gallery = product.productGalleries[i];
        oldGalleryPaths.push(gallery.pathFile);
        // Removing the product gallery
        await queryRunner.manager.remove(gallery);
      }

      // Removing the product
      await queryRunner.manager.remove(product);

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();

      this.error.methodNotAllowed([
        i18n.t(
          't.Some orders are related to this product, please delete the orders of this product first!',
        ),
      ]);
    } finally {
      await queryRunner.release();
    }

    oldGalleryPaths.forEach((pathFile) => {
      fs.unlink(path.join(__dirname, '../../..', 'uploads', pathFile), (e) =>
        console.log(e),
      );
    });

    oldFilePaths.forEach((pathFile) => {
      fs.unlink(path.join(__dirname, '../../..', 'uploads', pathFile), (e) =>
        console.log(e),
      );
    });

    return true;
  }

  /**
   * -------------------------------------------------------
   * DELETE /products/gallery/:id/admin
   */
  async deleteGallery(galleryId: number, user: UserEntity) {
    const i18n = I18nContext.current();

    const gallery = await this.galleryRepository
      .createQueryBuilder('gallery')
      .leftJoinAndSelect('gallery.product', 'product')
      .where({ id: galleryId })
      .getOne();

    if (!gallery) {
      this.error.unprocessableEntity([
        i18n.t('t.The product gallery not found!'),
      ]);
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

      .where(
        'product.id IN (:...productIds) AND product.companyId = :companyId',
        { productIds },
      )
      .getMany();

    return products.map((product) => ({
      ...product,

      discountedPrice:
        product.incredibleOffers?.[0]?.discountedPrice ||
        product.discountedPrice,

      productAttributeValues: product.productAttributeValues.map((pav) => ({
        ...pav,
        discountedPrice:
          pav.incredibleOffers?.[0]?.discountedPrice || pav.discountedPrice,
      })),
    }));
  }

  /**
   * -------------------------------------------------------
   * PUT /products/sort/admin
   */
  async sort(dto: ProductSortDto, user: UserEntity, filters = null) {
    const i18n = I18nContext.current();

    const conditions: any = {};
    if (dto.action) {
      conditions.id = dto.id;
    } else {
      conditions.number = dto.id;
    }

    const original = await this.productRepository
      .createQueryBuilder('product')
      .innerJoinAndSelect(
        'product.locales',
        'locales',
        'locales.language = :lang',
        { lang: i18n.lang },
      )
      .andWhere({ ...conditions })
      .getOne();

    if (!original) {
      return this.error.unprocessableEntity([
        i18n.t('t.This product not found'),
      ]);
    }

    let builder = this.productRepository
      .createQueryBuilder('product')
      .innerJoinAndSelect('product.category', 'category')
      .innerJoinAndSelect(
        'product.locales',
        'locales',
        'locales.language = :lang',
        { lang: i18n.lang },
      )
      .select(['product.id', 'product.number', 'product.displayOrder']);

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
      return this.error.unprocessableEntity([
        i18n.t('t.Replacement product not found'),
      ]);
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
    const attributeValue = await this.attributeService.getByIdAndCompanyId(
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
  async getMinMaxPricesForFilter(companyId: number, filters) {
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
      .andWhere({ companyId })
      .andWhere({ status: ProductStatus.active });

    builder = applyFiltersToBuilder(builder, filters);
    return await builder.getRawOne();
  }

  /**
   * -------------------------------------------------------
   */
  async getColorsFilter(companyId: number, filters) {
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
      .andWhere({ companyId })
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
  private mappingProduct(item) {
    const offer = item.incredibleOffers?.[0];
    delete item.incredibleOffers;

    return {
      ...item,
      price: item.showPrice ? item.price : 0,
      discountedPrice: item.showPrice
        ? offer?.discountedPrice || item.discountedPrice
        : 0,
      incredibleOfferExpire: offer?.toDate || null,
      productAttributeValues: item.productAttributeValues
        .filter(
          (attr) =>
            !!attr.attributeValue?.attribute?.id &&
            !!attr.attributeValue?.extraValue,
        )
        .map((attr) => ({
          id: attr.id,
          color: attr.attributeValue?.extraValue || null,
          secondColor: attr.attributeValue?.secondExtraValue || null,
          price: item.showPrice ? attr.price : 0,
          discountedPrice: item.showPrice
            ? attr.incredibleOffers?.[0]?.discountedPrice ||
              attr.discountedPrice
            : 0,
          quantity: item.quantity,
          incredibleOfferExpire: attr.incredibleOffers?.[0]?.toDate || null,
        })),
    };
  }

  /**
   * -------------------------------------------------------
   */
  async statistic() {
    const published = await this.productRepository.count({
      status: ProductStatus.active,
    });

    return {
      published,
    };
  }

  /**
   * -------------------------------------------------------
   */
  async getByNumberAndCompanyId(number) {
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

    builder.andWhere(
      '(product.number = :number OR productAttributeValues.number = :number)',
      { number },
    );

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
        this.error.unprocessableEntity(['This product number is already used']);
      }
    }
    // For attribute
    else {
      if (product.number === number && selfProductId !== product.id) {
        this.error.unprocessableEntity(['This product number is already used']);
      } else if (
        foundAttr &&
        ((selfProductAttrValueId && foundAttr.id !== selfProductAttrValueId) ||
          !selfProductAttrValueId)
      ) {
        this.error.unprocessableEntity(['This product number is already used']);
      }
    }
  }
}
