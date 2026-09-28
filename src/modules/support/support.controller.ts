import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { successfulResult } from '../../utils';
import { Customer } from '../../utils/decorators/customer.decorator';
import { User } from '../../utils/decorators/user.decorator';
import { CustomerJwtAuthGuard } from '../customer/jwt/jwt.guard';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { Roles } from '../auth/role/role.decorator';
import { RolesGuard } from '../auth/role/role.guard';
import { UserRoles } from '../user/entities/user.entity';
import { RequireCapabilities } from '../auth/capability/capability.decorator';
import { PermissionsGuard } from '../auth/capability/permissions.guard';
import { UserCapabilityName } from '../manual-payment/manual-payment.types';
import { SupportService } from './support.service';
import {
  CreateSupportMessageDto,
  CreateSupportRequestDto,
  UpdateSupportStatusDto,
} from './dto/support.dto';
import { SUPPORT_CATEGORIES } from './support.types';

@ApiTags('Support')
@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('categories')
  categories() {
    return successfulResult([], SUPPORT_CATEGORIES);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async listMine(@Customer('id') customerId: number) {
    const list = await this.supportService.listForCustomer(customerId);
    return successfulResult([], list);
  }

  @Post('me')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async createMine(
    @Customer('id') customerId: number,
    @Body() dto: CreateSupportRequestDto,
  ) {
    const created = await this.supportService.createForCustomer(customerId, dto);
    return successfulResult(['درخواست پشتیبانی ثبت شد'], created);
  }

  @Get('me/:id')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async getMine(@Customer('id') customerId: number, @Param('id') id: string) {
    const detail = await this.supportService.getForCustomer(customerId, Number(id));
    return successfulResult([], detail);
  }

  @Post('me/:id/messages')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async replyMine(
    @Customer('id') customerId: number,
    @Param('id') id: string,
    @Body() dto: CreateSupportMessageDto,
  ) {
    const detail = await this.supportService.replyAsCustomer(
      customerId,
      Number(id),
      dto,
    );
    return successfulResult(['پیام شما ثبت شد'], detail);
  }

  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.support_manage)
  async listAdmin() {
    const list = await this.supportService.listForStaff();
    return successfulResult([], list);
  }

  @Get('admin/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.support_manage)
  async getAdmin(@Param('id') id: string) {
    const detail = await this.supportService.getForStaff(Number(id));
    return successfulResult([], detail);
  }

  @Post('admin/:id/messages')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.support_manage)
  async replyAdmin(
    @User('id') userId: number,
    @Param('id') id: string,
    @Body() dto: CreateSupportMessageDto,
  ) {
    const detail = await this.supportService.replyAsStaff(userId, Number(id), dto);
    return successfulResult(['پاسخ پشتیبانی ثبت شد'], detail);
  }

  @Put('admin/:id/status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.support_manage)
  async statusAdmin(@Param('id') id: string, @Body() dto: UpdateSupportStatusDto) {
    const detail = await this.supportService.updateStatus(Number(id), dto);
    return successfulResult(['وضعیت درخواست به‌روز شد'], detail);
  }
}
