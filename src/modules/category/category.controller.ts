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
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { Headers } from '../../utils/decorators/header.decorator';
import { Page } from '../../utils/decorators/page.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { Filter } from '../../utils/decorators/filter.decorator';
import { CategoryStatus } from './entities/category.entity';
import { Company } from '../../utils/decorators/company.decorator';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { multerOptions } from '../../utils/multer.options';
import { Query, UploadedFile } from '@nestjs/common/decorators';
import { UpdateCategoryIconDto } from './dto/update-category-icon.dto';
import { I18n } from 'nestjs-i18n';
import { CategorySortDto } from './dto/category-sort.dto';
import { ErrorService } from '../../error/error.service';
import { DeleteCategoryDto } from './dto/delete-category.dto';

@ApiTags('Category')
@Headers()
@Controller('categories')
export class CategoryController {
  constructor(
    private categoryService: CategoryService,
    private error: ErrorService,
  ) {}

  /**
   * -------------------------------------------------------
   * GET /categories/admin
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  @ApiQuery({ name: 'company_id', required: false })
  @ApiQuery({ name: 'parent_id', required: false })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'status', required: false, enum: CategoryStatus })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAllForAdmin(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter(['status', ['company_id', 'companyId'], ['name', 'locales.name']])
    filters,
    @Query('parent_id') parentId,
    @User('companyId') companyId,
  ) {
    const list = await this.categoryService.getAllForAdmin(
      page,
      limit,
      filters,
      sorts,
      companyId,
      parentId,
    );

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /categories/:id/admin
   */
  @Get(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  async getByIdForAdmin(
    @Param('id') categoryId: number,
    @User('companyId') companyId,
  ) {
    const data = await this.categoryService.getByIdForAdmin(
      categoryId,
      companyId,
    );
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * GET /categories/tree
   */
  @Get('/tree')
  @ApiQuery({ name: 'child_id', required: false })
  async getAllTree(@Company('id') companyId, @Query('child_id') childId) {
    const list = await this.categoryService.getAllTree(companyId, childId);

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /categories
   */
  @Get()
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  @ApiQuery({
    name: 'parent_id',
    required: false,
    description: 'number | NULL',
  })
  @ApiQuery({ name: 'get_sub_ids', required: false, description: '1 | 0' })
  async getAll(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Company('id') companyId,
    @Query('parent_id') parentId,
    @Query('get_sub_ids') getSubIds,
  ) {
    const list = await this.categoryService.getAll(
      companyId,
      page,
      limit,
      sorts,
      parentId,
      getSubIds === '1',
    );

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /categories/:id
   */
  @Get(':id')
  @ApiQuery({ name: 'get_sub_ids', required: false, description: '1 | 0' })
  async getById(
    @Param('id') categoryId: number,
    @Company('id') companyId,
    @Query('get_sub_ids') getSubIds,
  ) {
    const data = await this.categoryService.getById(
      categoryId,
      companyId,
      getSubIds === '1',
    );
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * POST /categories/admin
   */
  @Post('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @HttpCode(HttpStatus.CREATED)
  async add(@Body() dto: CreateCategoryDto, @I18n() i18n) {
    const newCategory = await this.categoryService.add(dto);

    return successfulResult(
      [i18n.t('t.The category is created successfully')],
      newCategory,
    );
  }

  /**
   * -------------------------------------------------------
   * PUT /categories/sort/admin
   */
  @Put('sort/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'status', required: false, enum: CategoryStatus })
  async sort(
    @Body() dto: CategorySortDto,
    @User() user: UserEntity,
    @Filter(['status', ['name', 'locales.name']])
    filters,
    @I18n() i18n,
  ) {
    await this.categoryService.sort(dto, user, filters);

    return successfulResult([i18n.t('t.The category was sorted successfully')]);
  }

  /**
   * -------------------------------------------------------
   * PUT /categories/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async update(@Body() dto: UpdateCategoryDto, @I18n() i18n) {
    await this.categoryService.update(dto);

    return successfulResult([i18n.t('t.The category is updated successfully')]);
  }

  /**
   * -------------------------------------------------------
   * PUT /categories/icon/admin
   */
  @Put('/icon/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('icon', multerOptions('categories')))
  async updateIcon(
    @Body() dto: UpdateCategoryIconDto,
    @UploadedFile() icon,
    @User() user: UserEntity,
    @I18n() i18n,
  ) {
    const iconPath = await this.categoryService.updateIcon(dto, icon, user);

    return successfulResult(
      [i18n.t('t.The category icon is updated successfully')],
      iconPath,
    );
  }

  /**
   * -------------------------------------------------------
   * DELETE /categories/:id/icon/admin
   */
  @Delete(':id/icon/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async deleteIcon(
    @Param('id') categoryId: number,
    @User() user: UserEntity,
    @I18n() i18n,
  ) {
    await this.categoryService.deleteIcon(categoryId, user);

    return successfulResult([i18n.t('t.The category icon is deleted')]);
  }

  /**
   * -------------------------------------------------------
   * DELETE /categories/:id/admin
   */
  @Delete(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async delete(
    @Param('id') categoryId: number,
    @User() user: UserEntity,
    @Body() dto: DeleteCategoryDto,
    @I18n() i18n,
  ) {
    await this.categoryService.delete(categoryId, user, dto);

    return successfulResult([i18n.t('t.The category is deleted')]);
  }
}
