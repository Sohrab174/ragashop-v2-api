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
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { RolesGuard } from '../auth/role/role.guard';
import { UserEntity, UserRoles } from '../user/entities/user.entity';
import { CreateDiscountCouponDto } from './dto/create-discount-coupon.dto';
import { UpdateDiscountCouponDto } from './dto/update-discount-coupon.dto';
import { DiscountCouponService } from './discount-coupon.service';
import { successfulResult } from '../../utils';
import { Page } from '../../utils/decorators/page.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Filter } from '../../utils/decorators/filter.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { Roles } from '../auth/role/role.decorator';
import { User } from '../../utils/decorators/user.decorator';
import { CalculateDiscountCouponDto } from './dto/calculate-discount-coupon.dto';
import { Customer } from '../../utils/decorators/customer.decorator';
import { CustomerJwtAuthGuard } from '../customer/jwt/jwt.guard';

@ApiTags('Discount Coupon')
@Controller('discount-coupons')
export class DiscountCouponController {
  constructor(private discountCouponService: DiscountCouponService) {}

  /**
   * --------------------------------------------------------
   * GET /discount-coupons/1/admin
   */
  @Get('/:id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async getById(@Param('id') id: number) {
    const data = await this.discountCouponService.getById(id);
    return successfulResult([], data);
  }

  /**
   * --------------------------------------------------------
   * Get /discount-coupons/admin
   */
  @Get('/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @ApiQuery({ name: 'title', required: false })
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'start_at', required: false })
  @ApiQuery({ name: 'end_at', required: false })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async list(
    @Page() page,
    @Limit(50) limit,
    @Filter(['title', 'code', ['start_at', 'startAt'], ['end_at', 'endAt']])
    filters,
    @Sort() sorts,
  ) {
    const list = await this.discountCouponService.list(
      page,
      limit,
      filters,
      sorts,
    );
    return successfulResult([], list);
  }

  /**
   * --------------------------------------------------------
   * POST /discount-coupons/calculate/me
   */
  @Post('/calculate/me')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async calculateByCode(
    @Body() dto: CalculateDiscountCouponDto,
    @Customer('id') customerId: number,
  ) {
    const data = await this.discountCouponService.calculateDiscountByCouponCode(
      dto.code,
      dto?.amount || 0,
      customerId,
      false,
    );
    return successfulResult([], data);
  }

  /**
   * --------------------------------------------------------
   * POST /discount-coupons/admin
   */
  @Post('/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @HttpCode(HttpStatus.CREATED)
  async addByAdmin(
    @Body() dto: CreateDiscountCouponDto,
    @User() user: UserEntity,
  ) {
    const newDiscountCoupon = await this.discountCouponService.addNew(
      dto,
      user,
    );
    return successfulResult(
      ['کد تخفیف جدید با موفقیت ایجاد شد'],
      newDiscountCoupon,
    );
  }

  /**
   * --------------------------------------------------------
   * PUT /discount-coupons/admin
   */
  @Put('/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async updateById(@Body() dto: UpdateDiscountCouponDto) {
    await this.discountCouponService.updateById(dto);
    return successfulResult(['کد تخفیف مربوطه، با موفقیت ویرایش شد']);
  }

  /**
   * -------------------------------------------------------
   * DELETE /discount-coupons/1/admin
   */
  @Delete('/:id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async deleteById(@Param('id') id: number) {
    await this.discountCouponService.deleteById(id);
    return successfulResult(['کد تخفیف موردنظر، باموفقیت حذف شد']);
  }
}
