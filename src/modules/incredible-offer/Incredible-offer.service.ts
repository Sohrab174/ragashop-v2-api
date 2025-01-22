import { Injectable } from '@nestjs/common';
import { ErrorService } from 'src/error/error.service';
import { InjectRepository } from '@nestjs/typeorm';
import { IncredibleOfferEntity } from './entities/Incredible-offer.entity';
import { Repository } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { CreateIncredibleOfferDto } from './dto/create-incredible-offer.dto';
import * as xlsx from 'xlsx';
import * as fs from 'fs';
import { ProductService } from '../product/product.service';
import { I18nContext } from 'nestjs-i18n';
import { UpdateIncredibleOfferDto } from './dto/update-incredible-offer.dto';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  paginationResult,
} from '../../utils';
import { DeleteIncredibleOfferDto } from './dto/delete-incredible-offer.dto';
import { AttributeTypes } from '../attribute/entities/attribute.entity';
import { IncredibleOfferImportExcelDto } from './dto/incredible-offer-import-excel.dto';

@Injectable()
export class IncredibleOfferService {
  constructor(
    @InjectRepository(IncredibleOfferEntity)
    private incredibleOfferRepository: Repository<IncredibleOfferEntity>,

    private error: ErrorService,
    private productService: ProductService,
  ) {}

  /**
   * -------------------------------------------------------
   * POST /incredibleOffers/admin
   */
  async add(dto: CreateIncredibleOfferDto, user: UserEntity) {
    //Creating a new incredible offer
    const { identifiers } = await this.incredibleOfferRepository
      .createQueryBuilder()
      .insert()
      .values(
        dto.products.map((product) => ({
          productId: product.productId,
          productAttributeValueId: product.productAttributeValueId,
          discountedPrice: product.discountedPrice,
          fromDate: dto.fromDate,
          toDate: dto.toDate,
          createdAt: new Date(),
        })),
      )
      .execute();

    return identifiers.map((identifier) => identifier.id);
  }

  /**
   * -------------------------------------------------------
   * POST /incredibleOffers/import/excel/admin
   */
  async importExcel(
    dto: IncredibleOfferImportExcelDto,
    file: Express.Multer.File,
  ) {
    const i18n = I18nContext.current();

    const workbook = xlsx.readFile(file.path);

    const sheet_name = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheet_name];

    const range = 'A1:B1000000';
    const data = xlsx.utils.sheet_to_json(sheet, { range, defval: null });

    const results = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const [number, discountedPrice]: any = Object.values(row);

      try {
        const result = await this.productService.getByNumberAndCompanyId(
          number,
        );

        if (!result) {
          results.push({
            number,
            success: false,
            message: i18n
              .t('t.No product with this number was found')
              .replace(/^t\./i, ''),
          });
          continue;
        }

        const foundOffer = await this.incredibleOfferRepository.findOne({
          productId: result.productId,
          ...(result.productAttributeValueId && {
            productAttributeValueId: result.productAttributeValueId,
          }),
          discountedPrice,
          fromDate: dto.fromDate,
          toDate: dto.toDate,
        });

        if (foundOffer) {
          results.push({
            number,
            success: false,
            message: i18n
              .t('t.The offer has already been created for this product')
              .replace(/^t\./i, ''),
          });
          continue;
        }

        await this.incredibleOfferRepository
          .createQueryBuilder()
          .insert()
          .values({
            productId: result.productId,
            productAttributeValueId: result.productAttributeValueId,
            discountedPrice,
            fromDate: dto.fromDate,
            toDate: dto.toDate,
            createdAt: new Date(),
          })
          .execute();

        results.push({
          number,
          success: true,
          message: i18n
            .t('t.The offer for this product has been created successfully')
            .replace(/^t\./i, ''),
        });
      } catch (e) {
        results.push({
          number,
          success: false,
          message: i18n
            .t('t.An unexpected error has occurred')
            .replace(/^t\./i, ''),
        });
      }
    }

    fs.unlink(file.path, (e) => console.log(e));

    return results;
  }

  /**
   * -------------------------------------------------------
   * PUT /incredible-offers/admin
   */
  async update(dto: UpdateIncredibleOfferDto) {
    const foundOffer = await this.incredibleOfferRepository.findOne({
      id: dto.id,
    });

    if (foundOffer) {
      return await this.incredibleOfferRepository
        .createQueryBuilder()
        .update()
        .set(dto)
        .where({ id: dto.id })
        .execute();
    }
  }

  /**
   * -------------------------------------------------------
   * GET /incredible-offers/:id/admin
   */
  async getById(offerId: number, user) {
    const builder = this._builder(user.companyId);
    builder.andWhere({ id: offerId });

    return await builder.getOne();
  }

  /**
   * -------------------------------------------------------
   * GET /incredible-offers/admin
   */
  async getAllForAdmin(
    page = 1,
    limit = 20,
    filters = null,
    sorts = null,
    user,
  ) {
    let builder = this._builder(user.companyId);

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('offer.id', 'DESC');
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
   * GET /incredible-offers
   */
  async getAll(companyId, page = 1, limit = 20, showRandom = false) {
    const builder = this._builder(companyId);

    const now = new Date();
    builder.andWhere('offer.fromDate <= :now', { now });
    builder.andWhere('offer.toDate >= :now', { now });

    if (showRandom) {
      builder.orderBy('RAND()');
    } else {
      builder.orderBy('offer.toDate', 'ASC');
      builder.addOrderBy('offer.id', 'DESC');
    }

    const [items, totalItems] = await builder
      .take(limit)
      .skip((page - 1) * limit)
      .getManyAndCount();

    return {
      items: items.map((item) => ({
        id: item.product.id,
        number: item.product.number,
        cover: item.product.cover,
        quantity: item.product.quantity,
        price: item.product.price,
        discountedPrice: item.productAttributeValue
          ? item.product.discountedPrice
          : item.discountedPrice,
        incredibleOfferExpire: item.productAttributeValue ? null : item.toDate,
        showPrice: true,
        productAttributeValues: item.productAttributeValue
          ? [
              {
                id: item.productAttributeValue.id,
                color:
                  item.productAttributeValue.attributeValue.attribute.type ===
                  AttributeTypes.color
                    ? item.productAttributeValue.attributeValue.extraValue
                    : null,
                // secondColor:
                //   item.productAttributeValue.attributeValue.attribute.type ===
                //   AttributeTypes.color
                //     ? item.productAttributeValue.attributeValue.secondExtraValue
                //     : null,
                price: item.productAttributeValue.price,
                discountedPrice: item.discountedPrice,
                quantity: item.productAttributeValue.quantity,
                incredibleOfferExpire: item.toDate,
              },
            ]
          : [],
      })),
      pagination: paginationResult(page, limit, totalItems),
    };
  }

  /**
   * -------------------------------------------------------
   * DELETE /incredible-offers/admin
   */
  async delete(dto: DeleteIncredibleOfferDto) {
    const { affected } = await this.incredibleOfferRepository
      .createQueryBuilder()
      .delete()
      .whereInIds(dto.ids)
      .execute();

    return { affected };
  }

  /**
   * -------------------------------------------------------
   */
  private _builder(companyId) {
    const builder = this.incredibleOfferRepository
      .createQueryBuilder('offer')
      .innerJoin('offer.product', 'product')

      .leftJoin('product.cover', 'productCover')
      .innerJoin('offer.company', 'company')
      .leftJoin('offer.productAttributeValue', 'productAttributeValue')
      .leftJoin('productAttributeValue.attributeValue', 'attributeValue')

      .leftJoin('attributeValue.attribute', 'attribute')

      .select([
        'offer.id',
        'offer.productId',
        'offer.productAttributeValueId',
        'offer.companyId',
        'offer.discountedPrice',
        'offer.fromDate',
        'offer.toDate',
        'offer.createdAt',

        'product.id',
        'product.number',
        'product.price',
        'product.discountedPrice',
        'product.quantity',

        'productCover.id',
        'productCover.type',
        'productCover.pathFile',

        'productAttributeValue.id',
        'productAttributeValue.price',
        'productAttributeValue.quantity',
        'productAttributeValue.number',
        'attributeValue.id',
        'attributeValue.extraValue',
        'attributeValue.secondExtraValue',

        'attribute.id',
        'attribute.type',
      ]);

    if (companyId) {
      builder.andWhere({ companyId });
    }

    return builder;
  }
}
