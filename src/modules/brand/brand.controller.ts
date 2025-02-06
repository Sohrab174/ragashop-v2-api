import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Delete,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiQuery, ApiTags } from '@nestjs/swagger';

import { successfulResult } from '../../utils';
import { User } from '../../utils/decorators/user.decorator';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { Roles } from '../auth/role/role.decorator';
import { RolesGuard } from '../auth/role/role.guard';
import { UserEntity, UserRoles } from '../user/entities/user.entity';
import { Page } from '../../utils/decorators/page.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { Filter } from '../../utils/decorators/filter.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { multerOptions } from '../../utils/multer.options';
import { Query, UploadedFile } from '@nestjs/common/decorators';
import { ErrorService } from '../../error/error.service';
import { BrandService } from './brand.service';

@ApiTags('Brand')
@Controller('brands')
export class BrandController {
  constructor(
    private brandService: BrandService,
    private error: ErrorService,
  ) {}

  /**
   * -------------------------------------------------------
   * GET /brands/admin
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'is_selection', required: false })
  @ApiQuery({ name: 'description', required: false })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAllForAdmin(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter([['description'], ['name']])
    filters,
    @Query('is_selection') isSelection,
  ) {
    const list = await this.brandService.getAllForAdmin(
      page,
      limit,
      filters,
      sorts,
      isSelection === '1',
    );

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /brands/:id/admin
   */
  @Get(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  async getByIdForAdmin(@Param('id') brandId: number) {
    const data = await this.brandService.getByIdForAdmin(brandId);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * GET /brands
   */
  @Get()
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  @ApiQuery({
    name: 'is_selection',
    required: false,
  })
  @ApiQuery({ name: 'is_selection', required: false, description: '1 | 0' })
  async getAll(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Query('is_selection') isSelection,
  ) {
    const list = await this.brandService.getAll(
      page,
      limit,
      sorts,
      isSelection === '1',
    );

    return successfulResult([], list);
  }
}
