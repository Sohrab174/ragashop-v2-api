import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CityEntity } from './entities/city.entity';
import { ProvinceEntity } from './entities/province.entity';
import { ErrorService } from '../../error/error.service';
import { applyFiltersToBuilder, applySortingToBuilder } from '../../utils';

@Injectable()
export class CityService {
  constructor(
    @InjectRepository(CityEntity)
    private cityRepository: Repository<CityEntity>,

    @InjectRepository(ProvinceEntity)
    private provinceRepository: Repository<ProvinceEntity>,

    private error: ErrorService,
  ) {}

  /**
   * -------------------------------------------------------
   * GET /cities
   */
  async getAll(filters = null, sorts = null) {
    let builder = this.cityRepository
      .createQueryBuilder('city')
      .innerJoin('city.province', 'province')
      .select(['city.id', 'city.name', 'province.id', 'province.name']);

    builder = applyFiltersToBuilder(builder, filters);

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('city.id', 'ASC');
    }

    return await builder.getMany();
  }

  /**
   * -------------------------------------------------------
   * GET /provinces
   */
  async getProvinces() {
    return this.provinceRepository
      .createQueryBuilder('province')
      .select(['province.id', 'province.name'])
      .orderBy('province.name', 'ASC')
      .getMany();
  }
}
