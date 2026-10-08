import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { SettingService } from './setting.service';
import { successfulResult } from '../../utils';
import { UserRoles } from '../user/entities/user.entity';
import { RolesGuard } from '../auth/role/role.guard';
import { Roles } from '../auth/role/role.decorator';
import { PermissionsGuard } from '../auth/capability/permissions.guard';
import { RequireCapabilities } from '../auth/capability/capability.decorator';
import { UserCapabilityName } from '../auth/capability/capability.catalog';

@ApiTags('Setting')
@Controller('settings')
export class SettingController {
  constructor(private settingService: SettingService) {}

  /**
   * -------------------------------------------------------
   * Get /settings/admin
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.settings_read)
  async getByAdmin() {
    const data = await this.settingService.getByAdmin();
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * put /settings/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.settings_write)
  async update(@Body() dto: UpdateSettingDto) {
    await this.settingService.update(dto);
    return successfulResult(['تنظیمات سایت با موفقیت بروز شد']);
  }

  /**
   * -------------------------------------------------------
   * Get /settings
   */
  @Get()
  async get() {
    const data = await this.settingService.get();
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * Put /settings/try-to-rial
   * Privileged FX refresh (mutates last-known-good TRY→IRR).
   * Admin always allowed; employee requires settings.fx_refresh.
   */
  @Put('try-to-rial')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.settings_fx_refresh)
  async getTryToRial() {
    const data = await this.settingService.getTryToRial();
    return successfulResult([], data);
  }
}
