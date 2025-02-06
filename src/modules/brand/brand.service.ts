import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getConnection } from 'typeorm/globals';
import * as path from 'path';
import * as fs from 'fs';
import { ErrorService } from '../../error/error.service';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  findCategoryParentsByChildId,
  paginationResult,
} from '../../utils';

import { getLastDisplayOrder } from '../../utils/last-display-order';
import { UserEntity } from '../user/entities/user.entity';
import {
  applyPathToThumbPath,
  generateThumbnail,
  squareSizeImage,
} from '../../utils/sharp';
import { BrandEntity } from './entities/brand.entity';

@Injectable()
export class BrandService {
  constructor(
    @InjectRepository(BrandEntity)
    private brandRepository: Repository<BrandEntity>,

    private error: ErrorService,
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
  async getAll(page = 1, limit = 20, sorts = null, isSelection = false) {
    let builder = this.brandRepository.createQueryBuilder('brand');

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
}
