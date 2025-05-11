import { Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { successfulResult } from '../../utils';
import { FavoriteService } from './favorite.service';
import { ErrorService } from '../../error/error.service';
import { Customer } from '../../utils/decorators/customer.decorator';
import { CustomerEntity } from '../customer/entities/customer.entity';
import { CustomerJwtAuthGuard } from '../customer/jwt/jwt.guard';

@ApiTags('Favorite')
@Controller('favorites')
export class FavoriteController {
  constructor(
    private favoriteService: FavoriteService,
    private error: ErrorService,
  ) {}

  /**
   * -------------------------------------------------------
   * PUT /favorites/product/:productId/me
   */
  @Put('product/:productId/me')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async addDeleteProduct(
    @Param('productId') productId: number,
    @Customer() customer: CustomerEntity,
  ) {
    const result = await this.favoriteService.addDeleteProduct(
      productId,
      customer,
    );
    return successfulResult(
      [
        result
          ? 'کالا به لیست علاقه‌مندی شما افزوده شد.'
          : 'کالا از لیست علاقه‌مندی شما حذف شد.',
      ],
      result,
    );
  }

  /**
   * -------------------------------------------------------
   * GET /favorites/products/me
   */
  @Get('products/me')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async getProducts(@Customer() customer: CustomerEntity) {
    const list = await this.favoriteService.getProducts(customer);
    return successfulResult([], list);
  }
}
