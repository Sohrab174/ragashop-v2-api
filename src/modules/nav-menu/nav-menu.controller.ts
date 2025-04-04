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
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';

import { successfulResult } from '../../utils';
import { User } from '../../utils/decorators/user.decorator';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { Roles } from '../auth/role/role.decorator';
import { RolesGuard } from '../auth/role/role.guard';
import { UserEntity, UserRoles } from '../user/entities/user.entity';
import { NavMenuService } from './nav-menu.service';
import { CreateNavMenuDto } from './dto/create-nav-menu.dto';
import { Page } from '../../utils/decorators/page.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { Filter } from '../../utils/decorators/filter.decorator';
import { UpdateNavMenuDto } from './dto/update-nav-menu.dto';
import { NavMenuSortDto } from './dto/nav-menu-sort.dto';
import { ErrorService } from '../../error/error.service';
import { NavMenuPosition } from './entities/nav-menu.entity';

@ApiTags('Nav Menu')
@Controller('nav-menus')
export class NavMenuController {
  constructor(
    private navMenuService: NavMenuService,
    private error: ErrorService,
  ) {}

  /**
   * -------------------------------------------------------
   * GET /nav-menus/admin
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  @ApiQuery({ name: 'title', required: false })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAllForAdmin(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter(['title'])
    filters,
  ) {
    const list = await this.navMenuService.getAllForAdmin(
      page,
      limit,
      filters,
      sorts,
    );

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /nav-menus/:id/admin
   */
  @Get(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  async getByIdForAdmin(@Param('id') navMenuId: number) {
    const data = await this.navMenuService.getByIdForAdmin(navMenuId);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * GET /nav-menus
   */
  @Get()
  @ApiQuery({ name: 'position', required: false, enum: NavMenuPosition })
  async getAll(
    @Filter(['position'])
    filters,
  ) {
    const list = await this.navMenuService.getAll(filters);

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * POST /nav-menus/admin
   */
  @Post('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  @HttpCode(HttpStatus.CREATED)
  async add(@Body() dto: CreateNavMenuDto) {
    const newNavMenu = await this.navMenuService.add(dto);

    return successfulResult(['منوی جدید با موفقیت ایجاد شد'], newNavMenu);
  }

  /**
   * -------------------------------------------------------
   * PUT /nav-menus/sort/admin
   */
  @Put('sort/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  @ApiQuery({ name: 'title', required: false })
  async sort(
    @Body() dto: NavMenuSortDto,
    @Filter(['title'])
    filters,
  ) {
    await this.navMenuService.sort(dto, filters);

    return successfulResult(['منوی موردنظر جا‌به‌جا شد']);
  }

  /**
   * -------------------------------------------------------
   * PUT /nav-menus/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  async update(@Body() dto: UpdateNavMenuDto) {
    await this.navMenuService.update(dto);

    return successfulResult(['منوی مورد نظر با موفقیت آپدیت شد']);
  }

  /**
   * -------------------------------------------------------
   * DELETE /nav-menus/:id/admin
   */
  @Delete(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  async delete(@Param('id') navMenuId: number) {
    await this.navMenuService.delete(navMenuId);

    return successfulResult(['منوی مورد نظر حذف شد']);
  }
}
