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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ErrorService } from '../../error/error.service';
import { successfulResult } from '../../utils';
import { Filter } from '../../utils/decorators/filter.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Page } from '../../utils/decorators/page.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { User } from '../../utils/decorators/user.decorator';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { Roles } from '../auth/role/role.decorator';
import { RolesGuard } from '../auth/role/role.guard';
import { UserEntity, UserRoles } from '../user/entities/user.entity';
import { PageService } from './page.service';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';

@ApiTags('Page')
@Controller('pages')
export class PageController {
  constructor(private pageService: PageService, private error: ErrorService) {}

  /**
   * -------------------------------------------------------
   * GET /pages/admin
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
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
  @Roles(UserRoles.admin, UserRoles.employee)
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
   * GET /pages/:code
   */
  @Get(':code')
  async getById(@Param('code') code: string) {
    const data = await this.pageService.getById(code);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * POST /pages/admin
   */
  @Post('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @HttpCode(HttpStatus.CREATED)
  async add(@Body() dto: CreatePageDto, @User() user: UserEntity) {
    const newPage = await this.pageService.add(dto, user);

    return successfulResult(['صفحه باموفقیت ایجاد شد'], newPage);
  }

  /**
   * -------------------------------------------------------
   * PUT /pages/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async update(@Body() dto: UpdatePageDto, @User() user: UserEntity) {
    await this.pageService.update(dto, user);

    return successfulResult(['صفحه باموفقیت ویرایش شد']);
  }

  /**
   * -------------------------------------------------------
   * DELETE /pages/:id/admin
   */
  @Delete(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async delete(@Param('id') pageId: number, @User() user: UserEntity) {
    await this.pageService.delete(pageId);

    return successfulResult(['صفحه حذف شد']);
  }
}
