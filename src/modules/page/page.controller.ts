import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ErrorService } from '../../error/error.service';
import { successfulResult } from '../../utils';
import { Filter } from '../../utils/decorators/filter.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Page } from '../../utils/decorators/page.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { Roles } from '../auth/role/role.decorator';
import { RolesGuard } from '../auth/role/role.guard';
import { UserRoles } from '../user/entities/user.entity';
import { PageService } from './page.service';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';
import { CreatePageSectionDto } from './dto/create-page-section.dto';
import { UpdatePageSectionDto } from './dto/update-page-section.dto';
import { PageSectionSortDto } from './dto/page-sort-section.dto';
import { PageSectionItemSortDto } from './dto/page-sort-item.dto';
import { CreatePageSectionItemDto } from './dto/create-page-section-item.dto';
import { UpdatePageSectionItemDto } from './dto/update-page-section-item.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { UpdatePageSectionItemFileDto } from './dto/update-page-section-item-file.dto';
import { multerOptions } from '../../utils/multer.options';

@ApiTags('Page')
@Controller('pages')
export class PageController {
  constructor(private pageService: PageService, private error: ErrorService) {}

  /**
   * --------------------------------------------------------
   * Get /pages/1/sections/admin
   */
  @Get('/:id/sections/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  async list(@Param('id') pageId: number) {
    const list = await this.pageService.getSectionsByPageIdForAdmin(pageId);
    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /pages/admin
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  @ApiQuery({ name: 'title', required: false })
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAllForAdmin(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter(['code', 'title'])
    filters,
  ) {
    const list = await this.pageService.getAllForAdmin(
      page,
      limit,
      filters,
      sorts,
    );

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /pages/:id/admin
   */
  @Get(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  async getByIdForAdmin(@Param('id') pageId: number) {
    const data = await this.pageService.getByIdForAdmin(pageId);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * GET /pages
   */
  @Get()
  async getAll() {
    const list = await this.pageService.getAll();
    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /pages/:id
   */
  @Get(':id')
  async getById(@Param('id') id: string) {
    const data = await this.pageService.getById(id);
    return successfulResult([], data);
  }

  /**
   * --------------------------------------------------------
   * POST /pages/section/item/admin
   */
  @Post('/section/item/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  @HttpCode(HttpStatus.CREATED)
  async createItem(@Body() dto: CreatePageSectionItemDto) {
    const newItemId = await this.pageService.createItem(dto);
    return successfulResult(['آیتم جدید با موفقیت ایجاد شد'], newItemId);
  }

  /**
   * --------------------------------------------------------
   * POST /pages/section/admin
   */
  @Post('/section/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  @HttpCode(HttpStatus.CREATED)
  async createSection(@Body() dto: CreatePageSectionDto) {
    const newSectionId = await this.pageService.createSection(dto);
    return successfulResult(['سکشن جدید با موفقیت ایجاد شد'], newSectionId);
  }

  /**
   * -------------------------------------------------------
   * POST /pages/admin
   */
  @Post('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  @HttpCode(HttpStatus.CREATED)
  async add(@Body() dto: CreatePageDto) {
    const newPage = await this.pageService.add(dto);
    return successfulResult(['صفحه باموفقیت ایجاد شد'], newPage);
  }

  /**
   * -------------------------------------------------------
   * PUT /pages/section/item/sort/admin
   */
  @Put('/section/item/sort/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  async sortItem(@Body() dto: PageSectionItemSortDto) {
    await this.pageService.sortItem(dto);
    return successfulResult(['آیتم مورد نظر با موفقیت مرتب شد']);
  }

  /**
   * -------------------------------------------------------
   * PUT /pages/section/sort/admin
   */
  @Put('/section/sort/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  async sortSection(@Body() dto: PageSectionSortDto) {
    await this.pageService.sortSection(dto);
    return successfulResult(['سکشن مورد نظر با موفقیت مرتب شد']);
  }

  /**
   * -------------------------------------------------------
   * PUT /pages/section/item/file/admin
   */
  @Put('/section/item/file/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', multerOptions('pages')))
  async updateItemFile(
    @Body() dto: UpdatePageSectionItemFileDto,
    @UploadedFile() file,
  ) {
    await this.pageService.updateItemFile(dto, file);
    return successfulResult(['فایل با موفقیت به اضافه/روز شد']);
  }

  /**
   * --------------------------------------------------------
   * PUT /pages/section/item/admin
   */
  @Put('/section/item/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  async updateItem(@Body() dto: UpdatePageSectionItemDto) {
    await this.pageService.updateItemById(dto);
    return successfulResult(['آیتم جدید با موفقیت ویرایش شد']);
  }

  /**
   * --------------------------------------------------------
   * PUT /pages/section/admin
   */
  @Put('/section/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  async updateSection(@Body() dto: UpdatePageSectionDto) {
    await this.pageService.updateSectionById(dto);
    return successfulResult(['سکشن جدید با موفقیت ویرایش شد']);
  }

  /**
   * -------------------------------------------------------
   * PUT /pages/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  async update(@Body() dto: UpdatePageDto) {
    await this.pageService.update(dto);
    return successfulResult(['صفحه باموفقیت ویرایش شد']);
  }

  /**
   * -------------------------------------------------------
   * DELETE /pages/section/item/1/file/admin
   */
  @Delete('/section/item/:id/file/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  async deleteItemFile(@Param('id') id: number) {
    await this.pageService.deleteItemFile(id);
    return successfulResult(['فایل با موفقیت حذف شد']);
  }

  /**
   * -------------------------------------------------------
   * DELETE /pages/section/item/1/admin
   */
  @Delete('section/item/:id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  async deleteItem(@Param('id') itemId: number) {
    await this.pageService.deleteItemById(itemId);
    return successfulResult(['آیتم حذف شد']);
  }

  /**
   * -------------------------------------------------------
   * DELETE /pages/section/1/admin
   */
  @Delete('section/:id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  async deleteSection(@Param('id') sectionId: number) {
    await this.pageService.deleteSectionById(sectionId);
    return successfulResult(['آیتم حذف شد']);
  }

  /**
   * -------------------------------------------------------
   * DELETE /pages/1/admin
   */
  @Delete(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  async delete(@Param('id') pageId: number) {
    await this.pageService.delete(pageId);
    return successfulResult(['صفحه حذف شد']);
  }
}
