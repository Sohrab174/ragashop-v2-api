import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorService } from '../../error/error.service';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  paginationResult,
} from '../../utils';
import { BrandEntity } from './entities/brand.entity';
import { TranslatorService } from '../../thirdParty/translator/translator.service';

@Injectable()
export class BrandService {
  constructor(
    @InjectRepository(BrandEntity)
    private brandRepository: Repository<BrandEntity>,

    private error: ErrorService,
    private translatorService: TranslatorService,
  ) {}

  /**
   * -------------------------------------------------------
   * GET /brands/admin
   */
  async getAllForAdmin(
    page = 1,
    limit = 20,
    filters = null,
    sorts = null,
    isSelection: boolean,
  ) {
    let builder = this.brandRepository.createQueryBuilder('brand');

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('brand.id', 'ASC');
    }

    if (isSelection) {
      builder.andWhere({ isSelection: true });
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
   * GET /brands/:id/admin
   */
  async getByIdForAdmin(id: number) {
    const builder = this.brandRepository
      .createQueryBuilder('brand')
      .where({ id });

    const brand = await builder.getOne();

    if (!brand) {
      this.error.unprocessableEntity(['برند مورد نظر یافت نشد']);
    }

    return brand;
  }

  /**
   * -------------------------------------------------------
   * GET /brands
   */
  async getAll(
    page = 1,
    limit = 20,
    sorts = null,
    isSelection = false,
    categoryId,
    gender,
  ) {
    console.log('filters', { categoryId, gender });

    let builder = this.brandRepository
      .createQueryBuilder('brand')
      .innerJoin('brand.products', 'product');
    if (categoryId || gender) {
      if (categoryId && categoryId !== '2') {
        builder.andWhere('product.categoryId = :categoryId', { categoryId });
      }
      if (gender) {
        builder.andWhere('product.gender = :gender', { gender });
        // console.log('gender tesssssssssssssssssssssst', categoryId);
      }
      builder.distinct(true);
    }

    if (isSelection) {
      builder.andWhere({ isSelection: true });
    }

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('brand.id', 'ASC');
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
   */
  async addOrUpdate(
    source,
    sourceId,
    { sourceName, description = null, isVirtual = null },
  ) {
    let brand = await this.brandRepository.findOne({
      where: { source, sourceId },
      select: ['id', 'sourceName'],
    });

    if (brand) {
      if (brand.sourceName !== sourceName) {
        brand.sourceName = sourceName;
        brand.name = await this._findOrTranslate(sourceName);
        await brand.save();
      }
    } else {
      brand = this.brandRepository.create({
        source,
        sourceId,
        sourceName,
        name: await this._findOrTranslate(sourceName),
        description,
        isVirtual,
      });

      await this.brandRepository.save(brand);
    }

    return brand.id;
  }

  /**
   * -------------------------------------------------------
   */
  private async _findOrTranslate(sourceName) {
    const exist = await this.brandRepository
      .createQueryBuilder('brand')
      .select(['brand.id', 'brand.name'])
      .where('brand.sourceName = :sourceName', { sourceName })
      .andWhere('brand.name REGEXP :persianPattern', {
        persianPattern: '[\\u0600-\\u06FF]',
      })
      .getOne();

    if (exist) {
      return exist.name;
    }

    return (await this.translatorService.text(sourceName)) || sourceName;
  }
}
