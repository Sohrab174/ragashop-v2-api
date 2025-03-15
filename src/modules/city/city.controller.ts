import { Controller, Get } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { CityService } from './city.service';
import { Filter } from '../../utils/decorators/filter.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { successfulResult } from '../../utils';

@ApiTags('City')
@Controller('cities')
export class CityController {
  constructor(private cityService: CityService) {}

  /**
   * -------------------------------------------------------
   * GET /cities
   */
  @Get()
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'province_name', required: false })
  @ApiQuery({ name: 'province_id', required: false })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  async getAll(
    @Sort() sorts,
    @Filter([
      'name',
      ['province_name', 'province.name'],
      ['province_id', 'province.id'],
    ])
    filters,
  ) {
    const list = await this.cityService.getAll(filters, sorts);
    return successfulResult([], list);
  }
}
