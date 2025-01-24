import { HttpStatus } from '@nestjs/common';
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
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderService } from './order.service';

import { Roles } from '../auth/role/role.decorator';
import { UserRoles } from '../user/entities/user.entity';
import { Page } from '../../utils/decorators/page.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { Filter } from '../../utils/decorators/filter.decorator';
import { User } from '../../utils/decorators/user.decorator';
import { OrderStatus } from './entities/order.entity';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { Customer } from '../../utils/decorators/customer.decorator';
import { CustomerJwtAuthGuard } from '../customer/jwt/jwt.guard';
import { CreateOrderByAdminDto } from './dto/create-order-by-admin.dto';
import { UpdateOrderByAdminDto } from './dto/update-order-by-admin.dto';

@ApiTags('Order')
@Controller('orders')
export class OrderController {
  constructor(private orderService: OrderService) {}

  /**
   * -------------------------------------------------------
   * POST /orders/me
   */
  @Post('me')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async create(@Customer('id') customerId, @Body() dto: CreateOrderDto) {
    const newOrder = await this.orderService.addUpdate(dto, customerId);
    return successfulResult(
      ['t.The new order has been successfully created'],
      newOrder,
    );
  }

  /**
   * -------------------------------------------------------
   * POST /orders/admin
   */
  @Post('admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async createByAdmin(@Body() dto: CreateOrderByAdminDto) {
    const newOrder = await this.orderService.addUpdate(dto);
    return successfulResult(
      ['t.The new order has been successfully created'],
      newOrder,
    );
  }

  /**
   * -------------------------------------------------------
   * PUT /orders/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async updateByAdmin(@Body() dto: UpdateOrderByAdminDto) {
    await this.orderService.addUpdate(dto, null, dto.id);
    return successfulResult(['t.The order has been successfully updated']);
  }

  /**
   * -------------------------------------------------------
   * GET /orders/admin
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
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
  async update(@Body() dto: UpdateOrderStatusDto) {
    await this.orderService.updateStatus(dto);

    return successfulResult(['t.The order is updated successfully']);
  }

  /**
   * -------------------------------------------------------
   * DELETE /orders/:id/admin
   */
  @Delete(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async delete(@Param('id') orderId: number) {
    await this.orderService.delete(orderId);

    return successfulResult(['t.The order is deleted']);
  }
}
