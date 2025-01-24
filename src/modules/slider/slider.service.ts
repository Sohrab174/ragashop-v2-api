import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm/repository/Repository';

import { ErrorService } from '../../error/error.service';
import { CreateSliderDto } from './dto/create-slider.dto';

import {
  SliderEntity,
  SliderPositions,
  SliderType,
} from './entities/slider.entity';

import * as path from 'path';
import * as fs from 'fs';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  paginationResult,
} from '../../utils';
import { getLastDisplayOrder } from '../../utils/last-display-order';
import { UpdateSliderDto } from './dto/update-slider.dto';

@Injectable()
export class SliderService {
  constructor(
    @InjectRepository(SliderEntity)
    private sliderRepository: Repository<SliderEntity>,

    private error: ErrorService,
  ) {}

  /**
   * -------------------------------------------------------
   * POST /sliders/admin
   */
  async addSlider(
    dto: CreateSliderDto,
    file: Express.Multer.File,
    type: SliderType,
  ) {
    const pathFile = `/sliders/${file.filename}`;

    // Creating a new slider
    await this.sliderRepository
      .createQueryBuilder()
      .insert()
      .values({
        type,
        pathFile,
        position: dto.position || SliderPositions.top,
        title: dto.title || null,
        description: dto.description || null,
        url: dto.url || null,
        displayOrder: await getLastDisplayOrder(SliderEntity.name),
        createdAt: new Date(),
      })
      .execute();

    return pathFile;
  }

  /**
   * -------------------------------------------------------
   * PUT /sliders/admin
   */
  async updateSlider(
    dto: UpdateSliderDto,
    type: SliderType,
    file: Express.Multer.File = null,
  ) {
    const slider = await this.sliderRepository.findOne({
      id: dto.id,
    });
    if (!slider) {
      this.error.unprocessableEntity(['The slider not found!']);
    }

    const values: any = {
      ...dto,
      type,
    };
    delete values.file;

    if (file) {
      values.pathFile = `/sliders/${file.filename}`;

      // Remove the old slide file from disk
      fs.unlink(
        path.join(__dirname, '../../..', 'uploads', slider.pathFile),
        (e) => console.log(e),
      );
    }

    await this.sliderRepository
      .createQueryBuilder()
      .update()
      .set(values)
      .where({ id: dto.id })
      .execute();

    return true;
  }

  /**
   * -------------------------------------------------------
   * DELETE /sliders/:id/admin
   */
  async deleteSlider(sliderId: number) {
    const slider = await this.sliderRepository.findOne({
      id: sliderId,
    });

    if (!slider) {
      this.error.unprocessableEntity(['The slider not found!']);
    }

    const tempPathFile = slider.pathFile;

    await slider.remove();

    fs.unlink(path.join(__dirname, '../../..', 'uploads', tempPathFile), (e) =>
      console.log(e),
    );

    return true;
  }

  /**
   * -------------------------------------------------------
   * GET /sliders/positions/admin
   */
  async getPositions() {
    return [
      {
        position: 'top',
        hasTitle: false,
        hasDescription: false,
        hasUrl: true,
      },
      {
        position: 'center',
        hasTitle: false,
        hasDescription: false,
        hasUrl: true,
      },
    ];
  }

  /**
   * -------------------------------------------------------
   * GET /sliders/:id/admin
   */
  async getSliderById(sliderId: number) {
    const builder = this.sliderRepository
      .createQueryBuilder('slider')
      .andWhere({ id: sliderId });

    const slider = await builder.getOne();

    if (!slider) {
      this.error.unprocessableEntity(['The slider not found!']);
    }

    return slider;
  }

  /**
   * -------------------------------------------------------
   * GET /sliders/admin
   */
  async getAllSliders(page = 1, limit = 20, sorts = null) {
    let builder = this.sliderRepository.createQueryBuilder('slider');

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('slider.displayOrder', 'ASC');
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
   * GET /sliders
   */
  async getAll(page = 1, limit = 20, filters, sorts = null) {
    let builder = this.sliderRepository.createQueryBuilder('slider');

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('slider.displayOrder', 'ASC');
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
}
