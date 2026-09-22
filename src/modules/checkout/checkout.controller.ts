import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { successfulResult } from '../../utils';
import { Customer } from '../../utils/decorators/customer.decorator';
import { CustomerEntity } from '../customer/entities/customer.entity';
import { OptionalCustomerJwtAuthGuard } from '../customer/jwt/jwt.guard';
import { CreateCheckoutOrderDto } from './dto/create-checkout-order.dto';
import { CART_SESSION_HEADER, CheckoutService } from './checkout.service';

export const ORDER_ACCESS_HEADER = 'x-order-access-token';
export const IDEMPOTENCY_HEADER = 'idempotency-key';

@ApiTags('Checkout')
@ApiHeader({
  name: 'X-Cart-Session',
  required: false,
  description: 'Guest cart session key (UUID). Required when not logged in.',
})
@Controller('checkout')
export class CheckoutController {
  constructor(private checkoutService: CheckoutService) {}

  /**
   * GET /checkout
   * Authoritative checkout preview for the caller's owned cart.
   */
  @Get()
  @UseGuards(OptionalCustomerJwtAuthGuard)
  async preview(
    @Customer() customer: CustomerEntity | null,
    @Headers(CART_SESSION_HEADER) sessionHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const owner = this.checkoutService.resolveOwner(customer, sessionHeader);
    const data = await this.checkoutService.preview(owner);
    this.applySessionHeader(res, customer, owner.sessionKey ?? sessionHeader);
    return successfulResult([], data);
  }

  /**
   * POST /checkout/orders
   * Create unpaid/pending Order from owned Cart (no payment).
   */
  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(OptionalCustomerJwtAuthGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'UUID (or 16–64 token) — required to prevent duplicate orders',
  })
  async createOrder(
    @Customer() customer: CustomerEntity | null,
    @Headers(CART_SESSION_HEADER) sessionHeader: string | undefined,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey: string | undefined,
    @Body() dto: CreateCheckoutOrderDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const owner = this.checkoutService.resolveOwner(customer, sessionHeader);
    const data = await this.checkoutService.createOrderWithCityCheck(
      owner,
      dto,
      idempotencyKey,
    );
    this.applySessionHeader(res, customer, owner.sessionKey ?? sessionHeader);
    if (data.accessToken) {
      res.setHeader(ORDER_ACCESS_HEADER, data.accessToken);
    }
    return successfulResult(
      ['سفارش با موفقیت ثبت شد. پرداخت هنوز انجام نشده است.'],
      data,
    );
  }

  /**
   * GET /checkout/orders/:id
   * Read owned order confirmation (customer JWT or guest access token).
   */
  @Get('orders/:id')
  @UseGuards(OptionalCustomerJwtAuthGuard)
  @ApiHeader({
    name: 'X-Order-Access-Token',
    required: false,
    description: 'Required for guest order confirmation reads',
  })
  async getOrder(
    @Param('id') orderId: string,
    @Customer() customer: CustomerEntity | null,
    @Headers(CART_SESSION_HEADER) sessionHeader: string | undefined,
    @Headers(ORDER_ACCESS_HEADER) accessHeader: string | undefined,
    @Query('accessToken') accessQuery: string | undefined,
  ) {
    const owner = this.checkoutService.resolveOwner(customer, sessionHeader);
    const accessToken = accessHeader || accessQuery;
    const data = await this.checkoutService.getOwnedOrder(
      orderId,
      owner,
      accessToken,
    );
    return successfulResult([], data);
  }

  private applySessionHeader(
    res: Response,
    customer: CustomerEntity | null,
    sessionKey: string | null | undefined,
  ) {
    if (!customer?.id && sessionKey) {
      res.setHeader('X-Cart-Session', sessionKey);
    }
  }
}
