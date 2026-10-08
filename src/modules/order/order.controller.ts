import { GoneException, HttpStatus } from '@nestjs/common';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common/decorators';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { successfulResult } from '../../utils';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { RolesGuard } from '../auth/role/role.guard';
import { OrderService } from './order.service';

import { Roles } from '../auth/role/role.decorator';
import { UserRoles } from '../user/entities/user.entity';
import { Page } from '../../utils/decorators/page.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { Filter } from '../../utils/decorators/filter.decorator';
import { OrderStatus } from './entities/order.entity';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { Customer } from '../../utils/decorators/customer.decorator';
import { CustomerJwtAuthGuard } from '../customer/jwt/jwt.guard';
import { CreateOrderByAdminDto } from './dto/create-order-by-admin.dto';
import { UpdateOrderByAdminDto } from './dto/update-order-by-admin.dto';
import { OperationsDashboardService } from './operations-dashboard.service';
import { PermissionsGuard } from '../auth/capability/permissions.guard';
import { RequireCapabilities } from '../auth/capability/capability.decorator';
import { UserCapabilityName } from '../auth/capability/capability.catalog';
import { UserCapabilityService } from '../manual-payment/user-capability.service';
import { User } from '../../utils/decorators/user.decorator';

@ApiTags('Order')
@Controller('orders')
export class OrderController {
  constructor(
    private orderService: OrderService,
    private operationsDashboardService: OperationsDashboardService,
    private capabilityService: UserCapabilityService,
  ) {}

  /**
   * -------------------------------------------------------
   * Read-only operational queue counts for Admin dashboard
   * GET /orders/operations-dashboard/admin
   */
  @Get('operations-dashboard/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.order_read)
  async operationsDashboard() {
    const data = await this.operationsDashboardService.getCounts();
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * POST /orders/me — disabled (legacy commerce bypass)
   * Authoritative customer order creation is POST /checkout/orders.
   * Historical GET /orders/me and GET /orders/:id/me remain intact.
   */
  @Post('me')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  legacyCustomerCreateDisabled() {
    throw new GoneException({
      success: false,
      messages: [
        'ایجاد سفارش از این مسیر پشتیبانی نمی‌شود. از مسیر تسویه حساب استفاده کنید.',
      ],
      data: { code: 'legacy_order_create_disabled' },
    });
  }

  /**
   * -------------------------------------------------------
   * POST /orders/admin
   */
  @Post('admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.order_prepare)
  async createByAdmin(@Body() dto: CreateOrderByAdminDto) {
    const newOrder = await this.orderService.addUpdate(dto);
    return successfulResult(['سفارش جدید با موفقیت ثبت شد'], newOrder);
  }

  /**
   * -------------------------------------------------------
   * PUT /orders/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.order_prepare)
  async updateByAdmin(@Body() dto: UpdateOrderByAdminDto) {
    await this.orderService.addUpdate(dto, null, dto.id);
    return successfulResult(['سفارش با موفقیت ویرایش شد']);
  }

  /**
   * -------------------------------------------------------
   * GET /orders/admin
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.order_read)
  @ApiQuery({ name: 'number', required: false })
  @ApiQuery({ name: 'customer', required: false })
  @ApiQuery({ name: 'status', required: false, enum: OrderStatus })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  @ApiQuery({ name: 'date', required: false })
  async getAllForAdmin(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter(['number', 'status', ['date', 'order.createdAt', 'DATE']])
    filters,
    @Query('customer') customer: string,
  ) {
    const list = await this.orderService.getAllForAdmin(
      page,
      limit,
      filters,
      customer,
      sorts,
    );

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /orders/me
   */
  @Get('me')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  @ApiQuery({ name: 'number', required: false })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAll(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter(['number'])
    filters,
    @Customer('id') customerId: number,
  ) {
    const list = await this.orderService.getAll(
      page,
      limit,
      filters,
      sorts,
      customerId,
    );

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * Show orders
   * GET /orders/statistic/count/admin
   */
  @Get('statistic/count/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.order_read)
  @ApiQuery({ name: 'only_pending', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async statisticCount(
    @Query('from') from,
    @Query('to') to,
    @Query('only_pending') onlyPending,
  ) {
    const data = await this.orderService.statisticCount(
      onlyPending === '1',
      from,
      to,
    );
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * Show orders
   * GET /orders/statistic/best-sales-product/admin
   */
  @Get('statistic/best-sales-product/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.order_read)
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async statisticBestSalesByProduct(@Query('from') from, @Query('to') to) {
    const data = await this.orderService.statisticBestSalesByProduct(from, to);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * Show orders
   * GET /orders/statistic/best-sales-category/admin
   */
  @Get('statistic/best-sales-category/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.order_read)
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async statisticBestSalesByCategory(@Query('from') from, @Query('to') to) {
    const data = await this.orderService.statisticBestSalesByCategory(from, to);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * show chart of orders
   * GET /orders/statistic/chart/admin
   */
  @Get('statistic/chart/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.order_read)
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiQuery({ name: 'type', required: true, enum: ['daily', 'monthly'] })
  @ApiQuery({
    name: 'section',
    required: false,
    enum: ['online', 'in_restaurant'],
  })
  async statisticChart(
    @Query('from') from,
    @Query('to') to,
    @Query('type') type,
    @Query('section') section,
  ) {
    const data = await this.orderService.statisticChart(
      from,
      to,
      type,
      section,
    );
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * GET /orders/:id/admin
   */
  @Get(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.order_read)
  async getByIdForAdmin(@Param('id') orderId: number) {
    const data = await this.orderService.getByIdForAdmin(orderId);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * GET /orders/:id/me
   */
  @Get(':id/me')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async getById(
    @Param('id') orderId: number,
    @Customer('id') customerId: number,
    @Req() req,
  ) {
    const data = await this.orderService.getById(
      orderId,
      customerId,
      req.clientIp,
    );
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * PUT /orders/status/admin
   */
  @Put('status/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async update(@Body() dto: UpdateOrderStatusDto, @User() user) {
    const current = await this.orderService.getRecordById(dto.id);

    let required: UserCapabilityName;
    if (dto.status === OrderStatus.accepted) {
      required = UserCapabilityName.order_prepare;
    } else if (dto.status === OrderStatus.sent) {
      required =
        current?.status === OrderStatus.sent
          ? UserCapabilityName.order_tracking
          : UserCapabilityName.order_ship;
    } else if (dto.status === OrderStatus.delivered) {
      required = UserCapabilityName.order_ship;
    } else if (dto.status === OrderStatus.rejected) {
      required = UserCapabilityName.order_reject;
    } else {
      required = UserCapabilityName.order_prepare;
    }

    await this.capabilityService.assertUserHasCapability(user, required);
    await this.orderService.updateStatus(dto);

    return successfulResult(['سفارش با موفقیت آپدیت شد']);
  }

  /**
   * -------------------------------------------------------
   * DELETE /orders/:id/admin
   */
  @Delete(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.order_prepare)
  async delete(@Param('id') orderId: number) {
    await this.orderService.delete(orderId);

    return successfulResult(['سفارش موردنظر حذف شد']);
  }
}
