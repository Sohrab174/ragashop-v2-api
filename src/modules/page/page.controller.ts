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
import { Headers } from '../../utils/decorators/header.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Page } from '../../utils/decorators/page.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { User } from '../../utils/decorators/user.decorator';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { Roles } from '../auth/role/role.decorator';
import { RolesGuard } from '../auth/role/role.guard';
import { UserEntity, UserRoles } from '../user/entities/user.entity';
import { PageService } from './page.service';
import { I18n } from 'nestjs-i18n';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';
import { Company } from '../../utils/decorators/company.decorator';

@ApiTags('Page')
@Headers()
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
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  @ApiQuery({ name: 'company_id', required: false })
  @ApiQuery({ name: 'title', required: false })
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAllForAdmin(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter(['code', ['company_id', 'companyId'], ['title', 'locales.title']])
    filters,
    @User('companyId') companyId,
  ) {
    const list = await this.pageService.getAllForAdmin(
      page,
      limit,
      filters,
      sorts,
      companyId,
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
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  async getByIdForAdmin(
    @Param('id') pageId: number,
    @User('companyId') companyId,
  ) {
    const data = await this.pageService.getByIdForAdmin(pageId, companyId);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * GET /pages
   */
  @Get()
  async getAll(@Company('id') companyId) {
    const list = await this.pageService.getAll(companyId);
    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /pages/:code
   */
  @Get(':code')
  async getById(@Param('code') code: string, @Company('id') companyId) {
    const data = await this.pageService.getById(code, companyId);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * POST /pages/admin
   */
  @Post('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  @HttpCode(HttpStatus.CREATED)
  async add(
    @Body() dto: CreatePageDto,
    @User() user: UserEntity,
    @I18n() i18n,
  ) {
    const newPage = await this.pageService.add(dto, user);

    return successfulResult(
      [i18n.t('t.The page is created successfully')],
      newPage,
    );
  }

  /**
   * -------------------------------------------------------
   * PUT /pages/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  async update(
    @Body() dto: UpdatePageDto,
    @User() user: UserEntity,
    @I18n() i18n,
  ) {
    await this.pageService.update(dto, user);

    return successfulResult([i18n.t('t.The page is updated successfully')]);
  }

  /**
   * -------------------------------------------------------
   * DELETE /pages/:id/admin
   */
  @Delete(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  async delete(
    @Param('id') pageId: number,
    @User() user: UserEntity,
    @I18n() i18n,
  ) {
    await this.pageService.delete(pageId, user);

    return successfulResult([i18n.t('t.The page is deleted')]);
  }
}
