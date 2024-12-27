import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { I18n } from 'nestjs-i18n';
import { successfulResult } from '../../utils';
import { Filter } from '../../utils/decorators/filter.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Page } from '../../utils/decorators/page.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { Roles } from '../auth/role/role.decorator';
import { RolesGuard } from '../auth/role/role.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRoles, UserStatus } from './entities/user.entity';
import { UserService } from './user.service';
import { User } from '../../utils/decorators/user.decorator';

@ApiTags('User')
@Controller('users')
export class UserController {
  constructor(private userService: UserService) {}

  /**
   * -------------------------------------------------------
   * POST /users/god
   */
  @Post('god')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god)
  @HttpCode(HttpStatus.CREATED)
  async createForGod(@Body() dto: CreateUserDto, @I18n() i18n) {
    const newUser = await this.userService.add(dto);
    return successfulResult(
      [i18n.t('t.New user successfully created')],
      newUser,
    );
  }

  /**
   * -------------------------------------------------------
   * POST /users/admin
   */
  @Post('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  @HttpCode(HttpStatus.CREATED)
  async createForAdmin(
    @Body() dto: CreateUserDto,
    @I18n() i18n,
    @User('companyId') companyId: number,
  ) {
    // force
    dto.companyId = companyId;

    const newUser = await this.userService.add(dto);
    return successfulResult(
      [i18n.t('t.New user successfully created')],
      newUser,
    );
  }

  /**
   * -------------------------------------------------------
   * PUT /users/1/god
   */
  @Put('god')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god)
  async updateUserForGod(@Body() dto: UpdateUserDto, @I18n() i18n) {
    await this.userService.updateUser(dto.id, dto);
    return successfulResult([
      i18n.t('t.The user profile has been successfully edited'),
    ]);
  }

  /**
   * -------------------------------------------------------
   * PUT /users/1/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  async updateUserForAdmin(
    @Body() dto: UpdateUserDto,
    @I18n() i18n,
    @User('companyId') companyId: number,
  ) {
    // force
    dto.companyId = companyId;

    await this.userService.updateUser(dto.id, dto);
    return successfulResult([
      i18n.t('t.The user profile has been successfully edited'),
    ]);
  }

  /**
   * -------------------------------------------------------
   * GET /users
   */
  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin)
  @ApiQuery({ name: 'company_id', required: false })
  @ApiQuery({ name: 'first_name', required: false })
  @ApiQuery({ name: 'last_name', required: false })
  @ApiQuery({ name: 'email', required: false })
  @ApiQuery({ name: 'mobile', required: false })
  @ApiQuery({ name: 'status', required: false, enum: UserStatus })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async list(
    @Page() page,
    @Limit(50) limit,
    @Sort() sorts,
    @Filter([
      'status',
      'mobile',
      'email',
      ['company_id', 'companyId'],
      ['first_name', 'firstName'],
      ['last_name', 'lastName'],
    ])
    filters,
    @User('companyId') companyId: number,
  ) {
    const list = await this.userService.getAll(
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
   * GET /users/1
   */
  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin)
  async getById(
    @Param('id') userId: number,
    @User('companyId') companyId: number,
  ) {
    const userInfo = await this.userService.getById(userId, companyId);
    return successfulResult([], userInfo);
  }

  // /**
  //  * -------------------------------------------------------
  //  * DELETE /users/admin/1
  //  */
  // @Delete('admin/:id')
  // @ApiBearerAuth()
  // @UseGuards(JwtAuthGuard, RolesGuard)
  // @Roles(UserRoles.admin)
  // @HttpCode(HttpStatus.OK)
  // async deleteUser(@Param('id') id: number , @I18n() i18n) {
  //   await this.userService.deleteUser(id);
  //   return successfulResult([i18n.t('t.The user has been successfully deleted')]);
  // }
}
