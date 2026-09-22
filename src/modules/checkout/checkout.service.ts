import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as moment from 'jalali-moment';
import { getConnection, Repository } from 'typeorm';
import { ErrorService } from '../../error/error.service';
import { CustomerEntity } from '../customer/entities/customer.entity';
import { SettingService } from '../setting/setting.service';
import { ProductService } from '../product/product.service';
import { ProductEntity } from '../product/entities/product.entity';
import { CityEntity } from '../city/entities/city.entity';
import { CartEntity } from '../cart/entities/cart.entity';
import { CartItemEntity } from '../cart/entities/cart-item.entity';
import {
  CART_SESSION_HEADER,
  CartOwnerContext,
  CartService,
} from '../cart/cart.service';
import { OrderEntity, OrderStatus } from '../order/entities/order.entity';
import { OrderItemEntity } from '../order/entities/order-item.entity';
import { isOrderNumberUniqueViolation } from '../order/utils/duplicate-key.util';
import { isMysqlDuplicateKeyError } from '../order/utils/duplicate-key.util';
import { toToman } from '../cart/cart-line.resolve';
import { CreateCheckoutOrderDto } from './dto/create-checkout-order.dto';
import {
  buildCheckoutConfirmationToken,
  buildOwnerScopedIdempotencyKey,
  confirmationTokensMatch,
  generateGuestAccessToken,
  isValidIdempotencyKey,
  roundMoney,
} from './checkout-fingerprint';
import { isValidCheckoutPhone, normalizeCheckoutPhone } from './checkout-phone';
import { computeCheckoutTotals } from './checkout-totals';
import {
  mapLinesToStorefrontDisplay,
  resolveCheckoutLines,
  type CheckoutProductRow,
} from './checkout-line.resolve';
import { ProductCurrency } from '../product/entities/product.entity';
import {
  buildOrderItemCostSnapshot,
  resolveEffectiveCost,
} from '../finance/cost-resolution';
import { FX_RATE_SOURCE_TGJU } from '../finance/finance.types';
import { CostSource } from '../finance/finance.types';

export { CART_SESSION_HEADER };

export type StorefrontCheckoutPreview = {
  confirmationToken: string;
  itemCount: number;
  currencyDisplay: 'IRT';
  items: ReturnType<typeof mapLinesToStorefrontDisplay>;
  subtotal: number;
  shipping: {
    status: 'calculated';
    amount: number;
  };
  tax: {
    status: 'calculated';
    amount: number;
  };
  payableTotal: number;
  paymentNote: string;
};

export type StorefrontCheckoutOrder = {
  id: number;
  number: string;
  status: OrderStatus;
  paymentStatus: 'awaiting_payment';
  paymentStatusLabel: string;
  accessToken: string | null;
  createdAt: string;
  itemCount: number;
  currencyDisplay: 'IRT';
  items: Array<{
    id: number;
    productId: number;
    name: string;
    selectedOptions: Array<{
      name: string | null;
      label: string | null;
    }>;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  shipping: { status: 'calculated'; amount: number };
  tax: { status: 'calculated'; amount: number };
  payableTotal: number;
  delivery: {
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    address: string | null;
    addressDetails: string | null;
    postalCode: string | null;
    cityId: number | null;
    cityName: string | null;
    provinceName: string | null;
  };
  description: string | null;
};

@Injectable()
export class CheckoutService {
  constructor(
    @InjectRepository(CartEntity)
    private cartRepository: Repository<CartEntity>,
    @InjectRepository(CartItemEntity)
    private cartItemRepository: Repository<CartItemEntity>,
    @InjectRepository(OrderEntity)
    private orderRepository: Repository<OrderEntity>,
    @InjectRepository(OrderItemEntity)
    private orderItemRepository: Repository<OrderItemEntity>,
    @InjectRepository(ProductEntity)
    private productRepository: Repository<ProductEntity>,
    @InjectRepository(CityEntity)
    private cityRepository: Repository<CityEntity>,
    private cartService: CartService,
    private settingService: SettingService,
    private productService: ProductService,
    private error: ErrorService,
  ) {}

  resolveOwner(
    customer: CustomerEntity | null | undefined,
    sessionHeader: string | null | undefined,
  ): CartOwnerContext {
    return this.cartService.resolveOwner(customer, sessionHeader);
  }

  async preview(owner: CartOwnerContext): Promise<StorefrontCheckoutPreview> {
    const built = await this.buildAuthoritativeCheckoutState(owner, false);
    if (!built) {
      this.error.unprocessableEntity(['سبد خرید خالی است'], {
        code: 'cart_empty',
      });
    }
    if (built.validation.ok === false) {
      this.error.unprocessableEntity(['سبد خرید نیاز به بررسی دارد'], {
        code: 'cart_invalid',
        issues: built.validation.issues,
      });
    }

    const tryToToman = built.tryToToman;
    const displayItems = mapLinesToStorefrontDisplay(
      built.validation.lines,
      tryToToman,
    );

    return {
      confirmationToken: built.confirmationToken,
      itemCount: built.validation.lines.reduce((s, l) => s + l.quantity, 0),
      currencyDisplay: 'IRT',
      items: displayItems,
      subtotal: toToman(built.subtotalTry, tryToToman),
      shipping: {
        status: 'calculated',
        amount: toToman(built.totals.shippingTry, tryToToman),
      },
      tax: {
        status: 'calculated',
        amount: toToman(built.totals.taxTry, tryToToman),
      },
      payableTotal: toToman(built.totals.payableTry, tryToToman),
      paymentNote:
        'با ثبت سفارش، پرداخت انجام نمی‌شود. سفارش در وضعیت «در انتظار پرداخت» ایجاد می‌شود.',
    };
  }

  async createOrder(
    owner: CartOwnerContext,
    dto: CreateCheckoutOrderDto,
    idempotencyKeyRaw: string | null | undefined,
  ): Promise<StorefrontCheckoutOrder> {
    const clientIdempotencyKey = this.normalizeIdempotencyKey(idempotencyKeyRaw);
    const sessionKey = this.cartService.ensureSessionKey(owner);
    // Owner-scoped digest — raw client key is never globally authoritative.
    const idempotencyKey = buildOwnerScopedIdempotencyKey({
      clientKey: clientIdempotencyKey!,
      customerId: owner.customerId,
      sessionKey: owner.customerId != null ? null : sessionKey,
    });
    const delivery = this.validateDelivery(dto);

    const existing = await this.findOrderByIdempotency(idempotencyKey);
    if (existing) {
      this.assertOrderOwnedByCaller(existing, owner);
      return this.mapOrderConfirmation(
        existing.id,
        owner,
        existing.guestAccessToken,
      );
    }

    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let createdOrderId: number | null = null;
    let guestAccessToken: string | null = null;

    try {
      const cart = await this.lockCart(queryRunner, owner, sessionKey);

      if (!cart) {
        await this.maybeReturnConvertedOrder(owner, idempotencyKey);
        this.error.unprocessableEntity(['سبد خرید خالی است'], {
          code: 'cart_empty',
        });
      }

      const raced = await queryRunner.manager.findOne(OrderEntity, {
        where: { checkoutIdempotencyKey: idempotencyKey },
      });
      if (raced) {
        this.assertOrderOwnedByCaller(raced, owner);
        await queryRunner.commitTransaction();
        return this.mapOrderConfirmation(
          raced.id,
          owner,
          raced.guestAccessToken,
        );
      }

      const items = await queryRunner.manager.find(CartItemEntity, {
        where: { cartId: cart.id },
        order: { id: 'ASC' },
      });

      if (!items.length) {
        if (cart.lastConvertedOrderId) {
          const prior = await queryRunner.manager.findOne(OrderEntity, {
            where: { id: cart.lastConvertedOrderId },
          });
          if (prior) {
            this.assertOrderOwnedByCaller(prior, owner);
            await queryRunner.commitTransaction();
            return this.mapOrderConfirmation(
              prior.id,
              owner,
              prior.guestAccessToken,
            );
          }
        }
        this.error.unprocessableEntity(['سبد خرید خالی است'], {
          code: 'cart_empty',
        });
      }

      const productsById = await this.loadProductsByIds(
        items.map((i) => i.productId),
      );
      const validation = resolveCheckoutLines({
        items: items.map((i) => ({
          id: i.id,
          productId: i.productId,
          productAttributeValueId: i.productAttributeValueId,
          quantity: i.quantity,
        })),
        productsById,
      });

      if (validation.ok === false) {
        this.error.unprocessableEntity(['سبد خرید نیاز به بررسی دارد'], {
          code: 'cart_invalid',
          issues: validation.issues,
        });
      }

      const settings = await this.settingService.getByAdmin([
        'maxShippingCost',
        'shippingPercent',
        'taxPercent',
      ]);
      const fxRate =
        await this.settingService.requireFreshAuthoritativeTryToToman();
      const tryToToman = fxRate.tryToToman;
      const fxCapturedAt = new Date();

      const amount = roundMoney(
        validation.lines.reduce((acc, l) => acc + l.priceTry * l.quantity, 0),
      );
      const discount = roundMoney(
        validation.lines.reduce(
          (acc, l) => acc + (l.priceTry - l.unitPriceTry) * l.quantity,
          0,
        ),
      );
      const subtotalTry = roundMoney(amount - discount);
      const totals = computeCheckoutTotals(subtotalTry, settings);

      const confirmationToken = buildCheckoutConfirmationToken({
        cartId: cart.id,
        cartUpdatedAt: this.cartUpdatedAtIso(cart),
        lines: validation.lines.map((l) => ({
          productId: l.productId,
          productAttributeValueId: l.productAttributeValueId,
          quantity: l.quantity,
          unitPriceTry: l.unitPriceTry,
        })),
        subtotalTry,
        shippingTry: totals.shippingTry,
        taxTry: totals.taxTry,
        payableTry: totals.payableTry,
        tryToToman,
      });

      if (!confirmationTokensMatch(confirmationToken, dto.confirmationToken)) {
        this.error.conflict(
          [
            'مبالغ یا محتویات سبد خرید تغییر کرده است. لطفاً خلاصه سفارش را دوباره بررسی کنید.',
          ],
          {
            code: 'checkout_state_changed',
            requiresRefresh: true,
          },
        );
      }

      guestAccessToken = owner.customerId ? null : generateGuestAccessToken();

      createdOrderId = await this.insertOrderWithUniqueNumber(queryRunner, {
        customerId: owner.customerId,
        amount,
        discount,
        shipping: totals.shippingTry,
        tax: totals.taxTry,
        finalAmount: totals.payableTry,
        commercialCurrency: ProductCurrency.TRY,
        fxRateToIrt: tryToToman,
        fxCapturedAt,
        fxRateSource: fxRate.source || FX_RATE_SOURCE_TGJU,
        shippingCostActual: null,
        address: delivery.address,
        location: null,
        addressDetails: delivery.addressDetails,
        postalCode: delivery.postalCode,
        phone: delivery.phone,
        cityId: delivery.cityId,
        firstName: delivery.firstName,
        lastName: delivery.lastName,
        sourceTrackingCode: null,
        description: delivery.description,
        status: OrderStatus.pending,
        guestAccessToken,
        checkoutIdempotencyKey: idempotencyKey,
        createdAt: new Date(),
      });

      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(OrderItemEntity)
        .values(
          validation.lines.map((line) => {
            const product = productsById.get(line.productId);
            const pav =
              line.productAttributeValueId != null
                ? product?.productAttributeValues?.find(
                    (p) => p.id === line.productAttributeValueId,
                  )
                : null;
            const costSnap = buildOrderItemCostSnapshot(
              resolveEffectiveCost(
                {
                  purchaseCost: product?.purchaseCost,
                  landedUnitCost: product?.landedUnitCost,
                  costCurrency: product?.costCurrency as ProductCurrency,
                  costSource: product?.costSource as CostSource,
                },
                pav
                  ? {
                      purchaseCost: pav.purchaseCost,
                      landedUnitCost: pav.landedUnitCost,
                      costCurrency: pav.costCurrency as ProductCurrency,
                      costSource: pav.costSource as CostSource,
                    }
                  : null,
              ),
            );
            return {
              orderId: createdOrderId,
              productId: line.productId,
              productAttributeValueId: line.productAttributeValueId,
              productName: line.productName,
              optionName: line.optionName,
              optionLabel: line.optionLabel,
              price: line.priceTry,
              discountedPrice: line.discountedPriceTry,
              quantity: line.quantity,
              finalAmount: line.lineTotalTry,
              unitPurchaseCostSnapshot: costSnap.unitPurchaseCostSnapshot,
              unitLandedCostSnapshot: costSnap.unitLandedCostSnapshot,
              costCurrency: costSnap.costCurrency,
              cogsStatus: costSnap.cogsStatus,
              costSource: costSnap.costSource,
              createdAt: new Date(),
            };
          }),
        )
        .execute();

      for (const line of validation.lines) {
        let decremented = false;
        if (line.productAttributeValueId) {
          decremented = await this.productService.decrementAttributeQuantity(
            line.productAttributeValueId,
            line.quantity,
            queryRunner,
          );
        } else {
          decremented = await this.productService.decrementQuantity(
            line.productId,
            line.quantity,
            queryRunner,
          );
        }
        if (!decremented) {
          this.error.unprocessableEntity(
            ['موجودی محصول درخواستی کافی نمی‌باشد'],
            {
              code: 'insufficient_stock',
              issues: [
                {
                  cartItemId: line.cartItemId,
                  productId: line.productId,
                  code: 'insufficient_stock',
                  message: 'موجودی محصول درخواستی کافی نمی‌باشد',
                },
              ],
            },
          );
        }
      }

      await queryRunner.manager
        .createQueryBuilder()
        .delete()
        .from(CartItemEntity)
        .where('cartId = :cartId', { cartId: cart.id })
        .execute();

      await queryRunner.manager
        .createQueryBuilder()
        .update(CartEntity)
        .set({
          lastConvertedOrderId: createdOrderId,
          updatedAt: new Date(),
        })
        .where({ id: cart.id })
        .execute();

      await queryRunner.commitTransaction();
    } catch (err: any) {
      await queryRunner.rollbackTransaction();

      if (
        isMysqlDuplicateKeyError(err) ||
        isMysqlDuplicateKeyError(err?.driverError)
      ) {
        const racedExisting = await this.findOrderByIdempotency(idempotencyKey);
        if (racedExisting) {
          this.assertOrderOwnedByCaller(racedExisting, owner);
          return this.mapOrderConfirmation(
            racedExisting.id,
            owner,
            racedExisting.guestAccessToken,
          );
        }
      }

      if (err?.status) {
        throw err;
      }
      this.error.methodNotAllowed(['خطایی رخ داده است']);
    } finally {
      await queryRunner.release();
    }

    if (createdOrderId == null) {
      this.error.methodNotAllowed(['خطایی رخ داده است']);
    }
    return this.mapOrderConfirmation(createdOrderId, owner, guestAccessToken);
  }

  async getOwnedOrder(
    orderIdRaw: unknown,
    owner: CartOwnerContext,
    accessTokenRaw: string | null | undefined,
  ): Promise<StorefrontCheckoutOrder> {
    const orderId = Number(orderIdRaw);
    if (!Number.isInteger(orderId) || orderId < 1) {
      this.error.notFound(['سفارش موردنظر پیدا نشد']);
    }
    return this.mapOrderConfirmation(orderId, owner, accessTokenRaw);
  }

  private async mapOrderConfirmation(
    orderId: number,
    owner: CartOwnerContext,
    accessTokenRaw?: string | null,
  ): Promise<StorefrontCheckoutOrder> {
    const order = await this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.orderItems', 'orderItems')
      .leftJoinAndSelect('order.city', 'city')
      .leftJoinAndSelect('city.province', 'province')
      .where('order.id = :orderId', { orderId })
      .andWhere('order.isDeleted = 0')
      .getOne();

    if (!order) {
      this.error.notFound(['سفارش موردنظر پیدا نشد']);
    }

    this.assertCanReadOrder(order, owner, accessTokenRaw);

    const tryToToman = await this.settingService.getTryToToman();
    const items = (order.orderItems || []).map((oi) => {
      const unitTry =
        oi.discountedPrice && Number(oi.discountedPrice) > 0
          ? Number(oi.discountedPrice)
          : Number(oi.price);
      return {
        id: oi.id,
        productId: oi.productId,
        name: oi.productName || `محصول ${oi.productId}`,
        selectedOptions:
          oi.optionLabel || oi.optionName
            ? [{ name: oi.optionName, label: oi.optionLabel }]
            : [],
        quantity: oi.quantity,
        unitPrice: toToman(unitTry, tryToToman),
        lineTotal: toToman(Number(oi.finalAmount), tryToToman),
      };
    });

    const itemsAmountTry = roundMoney(
      Number(order.amount) - Number(order.discount || 0),
    );

    return {
      id: order.id,
      number: order.number,
      status: order.status,
      paymentStatus: 'awaiting_payment',
      paymentStatusLabel:
        order.status === OrderStatus.pending
          ? 'در انتظار پرداخت'
          : order.status === OrderStatus.paid
          ? 'پرداخت شده'
          : String(order.status),
      accessToken: owner.customerId ? null : order.guestAccessToken,
      createdAt: order.createdAt
        ? new Date(order.createdAt).toISOString()
        : new Date().toISOString(),
      itemCount: items.reduce((s, i) => s + i.quantity, 0),
      currencyDisplay: 'IRT',
      items,
      subtotal: toToman(itemsAmountTry, tryToToman),
      shipping: {
        status: 'calculated',
        amount: toToman(Number(order.shipping), tryToToman),
      },
      tax: {
        status: 'calculated',
        amount: toToman(Number(order.tax || 0), tryToToman),
      },
      payableTotal: toToman(Number(order.finalAmount), tryToToman),
      delivery: {
        firstName: order.firstName,
        lastName: order.lastName,
        phone: order.phone,
        address: order.address,
        addressDetails: order.addressDetails,
        postalCode: order.postalCode,
        cityId: order.cityId,
        cityName: order.city?.name ?? null,
        provinceName: order.city?.province?.name ?? null,
      },
      description: order.description,
    };
  }

  private assertCanReadOrder(
    order: OrderEntity,
    owner: CartOwnerContext,
    accessTokenRaw?: string | null,
  ) {
    if (owner.customerId) {
      if (order.customerId !== owner.customerId) {
        this.error.notFound(['سفارش موردنظر پیدا نشد']);
      }
      return;
    }

    const token =
      typeof accessTokenRaw === 'string' ? accessTokenRaw.trim() : '';
    if (
      !order.guestAccessToken ||
      !token ||
      !confirmationTokensMatch(order.guestAccessToken, token)
    ) {
      this.error.notFound(['سفارش موردنظر پیدا نشد']);
    }

    // Guest orders must remain guest-owned (no customerId).
    if (order.customerId != null) {
      this.error.notFound(['سفارش موردنظر پیدا نشد']);
    }
  }

  private assertOrderOwnedByCaller(
    order: OrderEntity,
    owner: CartOwnerContext,
  ) {
    if (owner.customerId) {
      if (order.customerId !== owner.customerId) {
        this.error.forbidden(['دسترسی مجاز نیست']);
      }
      return;
    }
    if (order.customerId != null) {
      this.error.forbidden(['دسترسی مجاز نیست']);
    }
  }

  private validateDelivery(dto: CreateCheckoutOrderDto) {
    const firstName = String(dto.firstName || '').trim();
    const lastName = String(dto.lastName || '').trim();
    const address = String(dto.address || '').trim();
    const addressDetails = dto.addressDetails
      ? String(dto.addressDetails).trim()
      : null;
    const postalCode = dto.postalCode ? String(dto.postalCode).trim() : null;
    const description = dto.description ? String(dto.description).trim() : null;
    const cityId = Number(dto.cityId);

    const fieldErrors: Record<string, string> = {};

    if (!firstName) fieldErrors.firstName = 'نام الزامی است';
    if (!lastName) fieldErrors.lastName = 'نام خانوادگی الزامی است';
    if (!address || address.length < 5) {
      fieldErrors.address = 'آدرس تحویل را کامل وارد کنید';
    }
    if (!Number.isInteger(cityId) || cityId < 1) {
      fieldErrors.cityId = 'شهر معتبر نیست';
    }

    const phone = normalizeCheckoutPhone(dto.phone);
    if (!isValidCheckoutPhone(phone) || !phone) {
      fieldErrors.phone = 'شماره موبایل معتبر نیست';
    }

    if (Object.keys(fieldErrors).length) {
      this.error.unprocessableEntity(['اطلاعات تحویل ناقص یا نامعتبر است'], {
        code: 'delivery_invalid',
        fields: fieldErrors,
      });
    }

    return {
      firstName,
      lastName,
      phone,
      address,
      addressDetails: addressDetails || null,
      postalCode: postalCode || null,
      cityId,
      description: description || null,
    };
  }

  private normalizeIdempotencyKey(
    raw: string | null | undefined,
  ): string | null {
    if (raw == null || !String(raw).trim()) {
      this.error.unprocessableEntity(['کلید تکرار درخواست الزامی است'], {
        code: 'idempotency_required',
      });
    }
    const key = String(raw).trim();
    if (!isValidIdempotencyKey(key)) {
      this.error.unprocessableEntity(['کلید تکرار درخواست نامعتبر است'], {
        code: 'idempotency_invalid',
      });
    }
    return key;
  }

  private async findOrderByIdempotency(
    key: string,
  ): Promise<OrderEntity | null> {
    return this.orderRepository.findOne({
      where: { checkoutIdempotencyKey: key },
    });
  }

  private async maybeReturnConvertedOrder(
    owner: CartOwnerContext,
    idempotencyKey: string,
  ): Promise<never> {
    const existing = await this.findOrderByIdempotency(idempotencyKey);
    if (existing) {
      this.assertOrderOwnedByCaller(existing, owner);
    }
    this.error.unprocessableEntity(['سبد خرید خالی است'], {
      code: 'cart_empty',
    });
  }

  private async lockCart(
    queryRunner: ReturnType<
      ReturnType<typeof getConnection>['createQueryRunner']
    >,
    owner: CartOwnerContext,
    sessionKey: string,
  ): Promise<CartEntity | null> {
    const qb = queryRunner.manager
      .createQueryBuilder(CartEntity, 'cart')
      .setLock('pessimistic_write');
    if (owner.customerId) {
      qb.where('cart.customerId = :customerId', {
        customerId: owner.customerId,
      });
    } else {
      qb.where('cart.sessionKey = :sessionKey', { sessionKey });
    }
    return qb.getOne();
  }

  private async buildAuthoritativeCheckoutState(
    owner: CartOwnerContext,
    forUpdate: boolean,
  ) {
    const sessionKey = this.cartService.ensureSessionKey(owner);
    let cart: CartEntity | null = null;
    if (owner.customerId) {
      cart = await this.cartRepository.findOne({
        where: { customerId: owner.customerId },
      });
    } else if (sessionKey) {
      cart = await this.cartRepository.findOne({
        where: { sessionKey },
      });
    }
    if (!cart) return null;

    const items = await this.cartItemRepository.find({
      where: { cartId: cart.id },
      order: { id: 'ASC' },
    });
    if (!items.length) return null;

    const productsById = await this.loadProductsByIds(
      items.map((i) => i.productId),
    );
    const validation = resolveCheckoutLines({
      items: items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productAttributeValueId: i.productAttributeValueId,
        quantity: i.quantity,
      })),
      productsById,
    });

    const settings = await this.settingService.getByAdmin([
      'maxShippingCost',
      'shippingPercent',
      'taxPercent',
    ]);
    const tryToToman = await this.settingService.getTryToToman();

    if (validation.ok === false) {
      return {
        cart,
        validation,
        tryToToman,
        subtotalTry: 0,
        totals: computeCheckoutTotals(0, settings),
        confirmationToken: '',
      } as const;
    }

    const subtotalTry = roundMoney(
      validation.lines.reduce((s, l) => s + l.lineTotalTry, 0),
    );
    const totals = computeCheckoutTotals(subtotalTry, settings);
    const confirmationToken = buildCheckoutConfirmationToken({
      cartId: cart.id,
      cartUpdatedAt: this.cartUpdatedAtIso(cart),
      lines: validation.lines.map((l) => ({
        productId: l.productId,
        productAttributeValueId: l.productAttributeValueId,
        quantity: l.quantity,
        unitPriceTry: l.unitPriceTry,
      })),
      subtotalTry,
      shippingTry: totals.shippingTry,
      taxTry: totals.taxTry,
      payableTry: totals.payableTry,
      tryToToman,
    });

    void forUpdate;
    return {
      cart,
      validation,
      tryToToman,
      subtotalTry,
      totals,
      confirmationToken,
    } as const;
  }

  private cartUpdatedAtIso(cart: CartEntity): string {
    const d = cart.updatedAt ? new Date(cart.updatedAt) : new Date(0);
    return d.toISOString();
  }

  private async loadProductsByIds(
    productIds: number[],
  ): Promise<Map<number, CheckoutProductRow>> {
    const productsById = new Map<number, CheckoutProductRow>();
    const unique = [...new Set(productIds.filter((id) => id > 0))];
    if (!unique.length) return productsById;

    const products = await this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.cover', 'cover')
      .leftJoinAndSelect(
        'product.productAttributeValues',
        'pav',
        'pav.isDeleted = 0',
      )
      .leftJoinAndSelect('pav.attributeValue', 'attributeValue')
      .leftJoinAndSelect('attributeValue.attribute', 'attribute')
      .where('product.id IN (:...productIds)', { productIds: unique })
      .getMany();

    for (const product of products) {
      productsById.set(product.id, {
        id: product.id,
        name: product.name,
        price: product.price,
        discountedPrice: product.discountedPrice,
        quantity: product.quantity,
        isSellable: product.isSellable,
        isDeleted: product.isDeleted,
        status: product.status,
        categoryId: product.categoryId,
        coverPath: product.cover?.pathFile || null,
        purchaseCost: product.purchaseCost,
        landedUnitCost: product.landedUnitCost,
        costCurrency: product.costCurrency,
        costSource: product.costSource,
        productAttributeValues: (product.productAttributeValues || []).map(
          (pav) => ({
            id: pav.id,
            quantity: pav.quantity,
            price: pav.price,
            discountedPrice: pav.discountedPrice,
            purchaseCost: pav.purchaseCost,
            landedUnitCost: pav.landedUnitCost,
            costCurrency: pav.costCurrency,
            costSource: pav.costSource,
            attributeValue: pav.attributeValue
              ? {
                  id: pav.attributeValue.id,
                  name: pav.attributeValue.name,
                  extraValue: pav.attributeValue.extraValue,
                  attributeId: pav.attributeValue.attributeId,
                  attribute: pav.attributeValue.attribute
                    ? {
                        id: pav.attributeValue.attribute.id,
                        name: pav.attributeValue.attribute.name,
                        type: pav.attributeValue.attribute.type,
                      }
                    : null,
                }
              : null,
          }),
        ),
      });
    }
    return productsById;
  }

  private async insertOrderWithUniqueNumber(
    queryRunner: ReturnType<
      ReturnType<typeof getConnection>['createQueryRunner']
    >,
    value: Record<string, unknown>,
    maxAttempts = 5,
  ): Promise<number> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const generatedNumber = await this.generateOrderNumber(
        queryRunner,
        attempt,
      );
      try {
        const { identifiers } = await queryRunner.manager
          .createQueryBuilder()
          .insert()
          .into(OrderEntity)
          .values({ ...value, number: generatedNumber })
          .execute();
        return identifiers[0].id;
      } catch (err) {
        if (isOrderNumberUniqueViolation(err) && attempt < maxAttempts - 1) {
          continue;
        }
        throw err;
      }
    }
    this.error.methodNotAllowed(['خطایی رخ داده است']);
  }

  private async generateOrderNumber(
    queryRunner: ReturnType<
      ReturnType<typeof getConnection>['createQueryRunner']
    >,
    collisionOffset = 0,
  ): Promise<string> {
    const orderNumber = moment().locale('fa').format('YYYYMM');
    const lastOrder = await queryRunner.manager
      .createQueryBuilder(OrderEntity, 'order')
      .orderBy('order.id', 'DESC')
      .getOne();

    if (!lastOrder) {
      return `${orderNumber}${1 + collisionOffset}`;
    }
    const lastCounter = +lastOrder.number.substring(6) || 0;
    return `${orderNumber}${lastCounter + 1 + collisionOffset}`;
  }

  /** Exposed for city validation in create — ensure city exists before txn. */
  async assertCityExists(cityId: number): Promise<void> {
    const city = await this.cityRepository.findOne({ where: { id: cityId } });
    if (!city) {
      this.error.unprocessableEntity(['شهر معتبر نیست'], {
        code: 'delivery_invalid',
        fields: { cityId: 'شهر معتبر نیست' },
      });
    }
  }

  async createOrderWithCityCheck(
    owner: CartOwnerContext,
    dto: CreateCheckoutOrderDto,
    idempotencyKeyRaw: string | null | undefined,
  ): Promise<StorefrontCheckoutOrder> {
    await this.assertCityExists(Number(dto.cityId));
    return this.createOrder(owner, dto, idempotencyKeyRaw);
  }
}
