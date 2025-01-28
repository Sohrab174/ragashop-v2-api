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
import { Page } from '../../utils/decorators/page.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { Filter } from '../../utils/decorators/filter.decorator';
import { CategoryStatus } from './entities/category.entity';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { multerOptions } from '../../utils/multer.options';
import { Query, UploadedFile } from '@nestjs/common/decorators';
import { UpdateCategoryIconDto } from './dto/update-category-icon.dto';
import { CategorySortDto } from './dto/category-sort.dto';
import { ErrorService } from '../../error/error.service';
import { DeleteCategoryDto } from './dto/delete-category.dto';

@ApiTags('Category')
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
    @Filter(['status', ['name']])
    filters,
    @Query('parent_id') parentId,
  ) {
    const list = await this.categoryService.getAllForAdmin(
      page,
      limit,
      filters,
      sorts,
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
  async getByIdForAdmin(@Param('id') categoryId: number) {
    const data = await this.categoryService.getByIdForAdmin(categoryId);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * GET /categories/tree
   */
  @Get('/tree')
  @ApiQuery({ name: 'child_id', required: false })
  async getAllTree(@Query('child_id') childId) {
    const list = await this.categoryService.getAllTree(childId);

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
  @ApiQuery({ name: 'is_selection', required: false, description: '1 | 0' })
  async getAll(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Query('parent_id') parentId,
    @Query('get_sub_ids') getSubIds,
    @Query('is_selection') isSelection,
  ) {
    const list = await this.categoryService.getAll(
      page,
      limit,
      sorts,
      parentId,
      getSubIds === '1',
      isSelection === '1',
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
    @Query('get_sub_ids') getSubIds,
  ) {
    const data = await this.categoryService.getById(
      categoryId,
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
  async add(@Body() dto: CreateCategoryDto) {
    const newCategory = await this.categoryService.add(dto);

    return successfulResult(['دسته بندی جدید با موفقیت ایجاد شد'], newCategory);
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
    @Filter(['status', ['name']])
    filters,
  ) {
    await this.categoryService.sort(dto, user, filters);

    return successfulResult(['دسته بندی موردنظر جا‌به‌جا شد']);
  }

  /**
   * -------------------------------------------------------
   * PUT /categories/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async update(@Body() dto: UpdateCategoryDto) {
    await this.categoryService.update(dto);

    return successfulResult(['دسته مورد نظر با موفقیت آپدیت شد']);
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
  ) {
    const iconPath = await this.categoryService.updateIcon(dto, icon);

    return successfulResult(
      ['آیکون دسته مورد نظر با موفقیت آپدیت شد'],
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
  async deleteIcon(@Param('id') categoryId: number, @User() user: UserEntity) {
    await this.categoryService.deleteIcon(categoryId, user);

    return successfulResult(['آیکون دسته مورد نظر حذف شد']);
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
  ) {
    await this.categoryService.delete(categoryId, user, dto);

    return successfulResult(['دسته مورد نظر حذف شد']);
  }
}
