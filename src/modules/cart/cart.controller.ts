import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { successfulResult } from '../../utils';
import { Customer } from '../../utils/decorators/customer.decorator';
import { CustomerEntity } from '../customer/entities/customer.entity';
import { OptionalCustomerJwtAuthGuard } from '../customer/jwt/jwt.guard';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart.dto';
import { CART_SESSION_HEADER, CartService } from './cart.service';

@ApiTags('Cart')
@ApiHeader({
  name: 'X-Cart-Session',
  required: false,
  description: 'Guest cart session key (UUID). Required when not logged in.',
})
@Controller('cart')
export class CartController {
  constructor(private cartService: CartService) {}

  @Get()
  @UseGuards(OptionalCustomerJwtAuthGuard)
  async getCart(
    @Customer() customer: CustomerEntity | null,
    @Headers(CART_SESSION_HEADER) sessionHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const owner = this.cartService.resolveOwner(customer, sessionHeader);
    const cart = await this.cartService.getCart(owner);
    this.applySessionHeader(res, cart.sessionKey);
    return successfulResult([], cart);
  }

  @Post('items')
  @UseGuards(OptionalCustomerJwtAuthGuard)
  async addItem(
    @Customer() customer: CustomerEntity | null,
    @Headers(CART_SESSION_HEADER) sessionHeader: string | undefined,
    @Body() dto: AddCartItemDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const owner = this.cartService.resolveOwner(customer, sessionHeader);
    const cart = await this.cartService.addItem(owner, dto);
    this.applySessionHeader(res, cart.sessionKey);
    return successfulResult(['محصول به سبد خرید افزوده شد.'], cart);
  }

  @Patch('items/:id')
  @UseGuards(OptionalCustomerJwtAuthGuard)
  async updateItem(
    @Customer() customer: CustomerEntity | null,
    @Headers(CART_SESSION_HEADER) sessionHeader: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateCartItemDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const owner = this.cartService.resolveOwner(customer, sessionHeader);
    const cart = await this.cartService.updateItem(owner, id, dto);
    this.applySessionHeader(res, cart.sessionKey);
    return successfulResult([], cart);
  }

  @Delete('items/:id')
  @UseGuards(OptionalCustomerJwtAuthGuard)
  async removeItem(
    @Customer() customer: CustomerEntity | null,
    @Headers(CART_SESSION_HEADER) sessionHeader: string | undefined,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const owner = this.cartService.resolveOwner(customer, sessionHeader);
    const cart = await this.cartService.removeItem(owner, id);
    this.applySessionHeader(res, cart.sessionKey);
    return successfulResult([], cart);
  }

  private applySessionHeader(
    res: Response,
    sessionKey: string | null | undefined,
  ) {
    if (sessionKey) {
      res.setHeader('X-Cart-Session', sessionKey);
    }
  }
}
