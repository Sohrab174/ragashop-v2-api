import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
  Put,
  Delete,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { successfulResult } from '../../utils';
import { Filter } from '../../utils/decorators/filter.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Page } from '../../utils/decorators/page.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { Roles } from '../auth/role/role.decorator';
import { RolesGuard } from '../auth/role/role.guard';
import { PermissionsGuard } from '../auth/capability/permissions.guard';
import { RequireCapabilities } from '../auth/capability/capability.decorator';
import { UserCapabilityName } from '../auth/capability/capability.catalog';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ReplaceUserCapabilitiesDto } from './dto/replace-user-capabilities.dto';
import { UserRoles, UserStatus } from './entities/user.entity';
import { UserService } from './user.service';
import { User } from '../../utils/decorators/user.decorator';
import { UserCapabilityService } from '../manual-payment/user-capability.service';

@ApiTags('User')
@Controller('users')
export class UserController {
  constructor(
    private userService: UserService,
    private capabilityService: UserCapabilityService,
  ) {}

  /**
   * -------------------------------------------------------
   * POST /users/admin
   */
  @Post('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.employee_manage)
  @HttpCode(HttpStatus.CREATED)
  async createForAdmin(@Body() dto: CreateUserDto, @User() actor) {
    const newUser = await this.userService.add(dto, actor);
    return successfulResult(['کاربر جدید با موفقیت ایجاد شد'], newUser);
  }

  /**
   * -------------------------------------------------------
   * PUT /users/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.employee_manage)
  async updateUserForAdmin(@Body() dto: UpdateUserDto, @User() actor) {
    await this.userService.updateUser(dto.id, dto, actor);
    return successfulResult(['مشخصات کاربر با موفقیت ویرایش شد']);
  }

  /**
   * -------------------------------------------------------
   * GET /users
   */
  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.employee_read)
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
      ['first_name', 'firstName'],
      ['last_name', 'lastName'],
    ])
    filters,
  ) {
    const list = await this.userService.getAll(page, limit, filters, sorts);
    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /users/:id/capabilities/admin
   * Must be registered before GET /users/:id
   */
  @Get(':id/capabilities/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin)
  @RequireCapabilities(UserCapabilityName.employee_permissions)
  async getCapabilities(@Param('id', ParseIntPipe) userId: number) {
    const data = await this.userService.getCapabilitiesForAdmin(userId);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * PUT /users/:id/capabilities/admin
   * Admin-only permission management (this phase).
   */
  @Put(':id/capabilities/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin)
  @RequireCapabilities(UserCapabilityName.employee_permissions)
  async replaceCapabilities(
    @Param('id', ParseIntPipe) userId: number,
    @Body() dto: ReplaceUserCapabilitiesDto,
  ) {
    const capabilities = await this.userService.replaceCapabilitiesForAdmin(
      userId,
      dto.capabilities || [],
    );
    return successfulResult(['دسترسی‌های کارمند ذخیره شد'], { capabilities });
  }

  /**
   * -------------------------------------------------------
   * GET /users/:id
   */
  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.employee_read)
  async getById(@Param('id', ParseIntPipe) userId: number) {
    const userInfo = await this.userService.getById(userId);
    return successfulResult([], userInfo);
  }

  /**
   * -------------------------------------------------------
   * DELETE /users/admin/:id
   */
  @Delete('admin/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.employee_manage)
  @HttpCode(HttpStatus.OK)
  async deleteUser(
    @Param('id', ParseIntPipe) id: number,
    @User() actor,
  ) {
    await this.userService.deleteUser(id, actor.id, actor);
    return successfulResult(['کاربر مورد نظر با موفقیت حذف شد.']);
  }
}
