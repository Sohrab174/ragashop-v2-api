import { HttpException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as moment from 'jalali-moment';
import { getConnection, Repository, QueryRunner } from 'typeorm';
import { ErrorService } from '../../error/error.service';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  digit,
  paginationResult,
} from '../../utils';

import { ProductService } from '../product/product.service';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderEntity, OrderStatus } from './entities/order.entity';
import { MailService } from '../../mail/mail.service';
import { ConfigurationService } from '../../config/configuration.service';
import { CustomerService } from '../customer/customer.service';
import { OrderStatusEntity } from './entities/order-status.entity';
import { AddressService } from '../address/address.service';
import { SettingService } from '../setting/setting.service';
import { WalletHistoryType } from '../customer/entities/wallet-history.entity';
import { CustomerEntity } from '../customer/entities/customer.entity';
import { ReferralAwardEntity } from '../customer/entities/referral-award.entity';
import { OrderPaymentFinalizationEntity } from './entities/order-payment-finalization.entity';
import { SettingEntity } from '../setting/entities/setting.entity';
import { ProductStatus } from '../product/entities/product.entity';
import { TelegrafBotService } from '../../thirdParty/telegraf/telegraf-bot.service';
import {
  parseStrictPositiveInt,
  validateAdminMoney,
  validateEffectiveSalePrice,
  validateOptionalPositiveIntId,
  validateOrderItemQuantity,
} from './utils/commerce-input.validator';
import {
  ORDER_COMPLETABLE_STATES,
  isOrderAlreadyPaid,
} from './utils/order-payable-states';
import {
  isInventoryReleaseBlocked,
  isOrderHardDeletionBlocked,
  FINANCIALLY_PRESERVED_TRANSACTION_STATUSES,
} from './utils/order-financial-preservation';
import { isOrderNumberUniqueViolation, isMysqlDuplicateKeyError } from './utils/duplicate-key.util';
import {
  isInventoryStillReserved,
  restoreReservedInventoryLines,
  ReservedInventoryLine,
} from './utils/order-inventory-release';
import {
  assertOrderStatusTransition,
  isAdminOrderRewriteAllowed,
} from './utils/order-status-transitions';
import { loadUnpaidOrderCleanupConfig } from './utils/unpaid-order-cleanup.config';
import {
  TransactionEntity,
  TransactionPaymentSource,
  TransactionStatus,
} from '../transaction/entities/transaction.entity';
import {
  GatewayEntity,
  GatewayStatus,
} from '../gateway/entities/gateway.entity';
import { ProductCurrency } from '../product/entities/product.entity';
import {
  buildOrderItemCostSnapshot,
  resolveEffectiveCost,
} from '../finance/cost-resolution';
import { normalizeOrderCogsToIrt } from '../finance/cogs-normalization';
import { FinancialEventService } from '../finance/financial-event.service';
import {
  FinancialEventType,
  FX_RATE_SOURCE_TGJU,
  ProfitabilityStatus,
} from '../finance/finance.types';
import { computeSettlementFromOrderSnapshot } from '../finance/settlement-money';
import { AuthoritativeTryToToman } from '../setting/setting.service';
import { PaymentSubmissionEntity } from '../manual-payment/entities/payment-submission.entity';
import {
  ACTIVE_MANUAL_PAYMENT_HOLD_STATUSES,
  PaymentSubmissionPurpose,
} from '../manual-payment/manual-payment.types';
import { hasActiveOrderPaymentHold } from '../manual-payment/utils/manual-payment.helpers';

export type InventoryReleaseOutcome =
  | 'released'
  | 'skipped_not_reserved'
  | 'skipped_financially_preserved'
  | 'not_found';

export type OrderPaymentClaimResult =
  | 'claimed'
  | 'same_transaction'
  | 'other_transaction';

@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(OrderEntity)
    private orderRepository: Repository<OrderEntity>,

    @InjectRepository(OrderItemEntity)
    private orderItemRepository: Repository<OrderItemEntity>,

    @InjectRepository(OrderStatusEntity)
    private orderStatusRepository: Repository<OrderStatusEntity>,

    @InjectRepository(ReferralAwardEntity)
    private referralAwardRepository: Repository<ReferralAwardEntity>,

    @InjectRepository(OrderPaymentFinalizationEntity)
    private orderPaymentFinalizationRepository: Repository<OrderPaymentFinalizationEntity>,

    private config: ConfigurationService,
    private mail: MailService,
    private productService: ProductService,
    // private amootsmsService: AmootsmsService,
    private error: ErrorService,
    // private discountCouponService: DiscountCouponService,
    private customerService: CustomerService,
    private addressService: AddressService,
    private settingService: SettingService,
    private telegrafBotService: TelegrafBotService,
    private financialEventService: FinancialEventService,
  ) {}

  /**
   * -------------------------------------------------------
   */
  async addUpdate(
    dto: any, // CreateOrderDto | CreateOrderByAdminDto | UpdateOrderByAdminDto
    customerId: number = null,
    orderId: number = null,
  ) {
    const isAdminOrder = !customerId && (dto.customerId || orderId);

    if (orderId) {
      parseStrictPositiveInt(orderId, this.error, 'درخواست نامعتبر است');
    }

    // Checking the customer by admin
    if (dto.customerId) {
      const adminCustomerId = parseStrictPositiveInt(
        dto.customerId,
        this.error,
        'مشتری پیدا نشد و یا حساب کاربری وی غیرفعال است',
      );
      if (!(await this.customerService.getActiveById(adminCustomerId))) {
        this.error.unprocessableEntity([
          'مشتری پیدا نشد و یا حساب کاربری وی غیرفعال است',
        ]);
      }
    }

    const addressId = parseStrictPositiveInt(
      dto.addressId,
      this.error,
      'آدرس انتخابی معتبر نمی‌باشد!',
    );

    const address = await this.addressService.getRecordById(
      addressId,
      customerId,
    );
    if (!address) {
      this.error.methodNotAllowed(['آدرس انتخابی معتبر نمی‌باشد!']);
    }

    // get products from DB
    const productIds = dto.productItems.map((item) =>
      parseStrictPositiveInt(
        item.productId,
        this.error,
        'محصول مورد نظر یافت نشد!',
      ),
    );
    const products = await this.productService.findByIds(productIds);

    // merge product items with product from db — prices always from DB for customers
    const mixedItems = [];
    dto.productItems.forEach((cartItem, index) => {
      const quantity = validateOrderItemQuantity(cartItem.quantity, this.error);
      const productId = productIds[index];

      const fromDb = products.find((product) => product.id === productId);

      if (!fromDb) {
        this.error.unprocessableEntity(['محصول مورد نظر یافت نشد!']);
      }

      if (
        !isAdminOrder &&
        (fromDb.isDeleted || fromDb.status !== ProductStatus.active)
      ) {
        this.error.unprocessableEntity(['محصول مورد نظر یافت نشد!']);
      }

      const variantIdSupplied =
        cartItem.productAttributeValueId !== undefined &&
        cartItem.productAttributeValueId !== null &&
        cartItem.productAttributeValueId !== '';

      const variantId = variantIdSupplied
        ? validateOptionalPositiveIntId(
            cartItem.productAttributeValueId,
            this.error,
            'تنوع محصول انتخابی معتبر نمی‌باشد',
          )
        : null;

      const productAttributeValue = variantId
        ? fromDb.productAttributeValues.find((pav) => pav.id === variantId)
        : null;

      if (variantId && !productAttributeValue) {
        this.error.unprocessableEntity(['تنوع محصول انتخابی معتبر نمی‌باشد']);
      }

      if (productAttributeValue?.isDeleted && !isAdminOrder) {
        this.error.unprocessableEntity(['تنوع محصول انتخابی معتبر نمی‌باشد']);
      }

      const allowClientPrice = isAdminOrder && cartItem.price != null;
      let price: number;
      let discountedPrice: number;

      if (productAttributeValue) {
        price = allowClientPrice
          ? validateAdminMoney(cartItem.price, this.error)
          : productAttributeValue.price ?? fromDb.price;
        discountedPrice = allowClientPrice
          ? 0
          : productAttributeValue.discountedPrice ??
            fromDb.discountedPrice ??
            null;
      } else {
        price = allowClientPrice
          ? validateAdminMoney(cartItem.price, this.error)
          : fromDb.price;
        discountedPrice = allowClientPrice ? 0 : fromDb.discountedPrice ?? null;
      }

      if (!isAdminOrder) {
        validateEffectiveSalePrice(price, discountedPrice, this.error);
      }

      mixedItems.push({
        ...fromDb,
        stockQuantity: fromDb.quantity,
        price,
        discountedPrice,
        quantity,
        productAttributeValue,
      });
    });

    // calculate order
    const amount = mixedItems.reduce(
      (acc, mixedItem) => acc + mixedItem.price * mixedItem.quantity,
      0,
    );
    const discount = mixedItems.reduce(
      (acc, mixedItem) =>
        acc +
        (mixedItem.price -
          (mixedItem?.discountedPrice ?? mixedItem?.price ?? 0)) *
          mixedItem.quantity,
      0,
    );

    // Calculating amount after doing discount
    const itemsAmount = amount - discount;

    const setting = await this.settingService.getByAdmin([
      'maxShippingCost',
      'shippingPercent',
      'taxPercent',
    ]);

    // Calculating tax
    let tax = 0;
    if (setting.taxPercent) {
      tax = (setting.taxPercent * itemsAmount) / 100;
    }

    // Calculating shipping — only admin may supply explicit shipping
    let shipping = 0;
    if (isAdminOrder && dto.shipping !== undefined) {
      shipping = validateAdminMoney(
        dto.shipping,
        this.error,
        'هزینه ارسال نامعتبر است',
      );
    } else if (setting.shippingPercent) {
      shipping = (setting.shippingPercent * itemsAmount) / 100;

      if (setting.maxShippingCost && shipping > setting.maxShippingCost) {
        shipping = setting.maxShippingCost;
      }
    }

    const finalAmount = itemsAmount + shipping + tax;

    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      let order: OrderEntity;

      // Updating the order — lock first, then load current items inside txn
      if (orderId) {
        order = await queryRunner.manager.findOne(OrderEntity, {
          where: { id: orderId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!order) {
          this.error.unprocessableEntity(['درخواست نامعتبر است']);
        }

        // C1: rewrite only while this order still owns an unpaid reservation.
        if (!isAdminOrderRewriteAllowed(order.status)) {
          this.error.unprocessableEntity([
            'ویرایش سفارش در این وضعیت مجاز نیست',
          ]);
        }

        const rewriteTransactions = await this.lockOrderTransactions(
          queryRunner,
          orderId,
        );
        const rewriteFinalization = await queryRunner.manager.findOne(
          OrderPaymentFinalizationEntity,
          { where: { orderId } },
        );
        const rewriteManualHold = await this.hasActiveManualPaymentHold(
          queryRunner,
          orderId,
        );

        if (
          isInventoryReleaseBlocked(
            order,
            rewriteTransactions,
            !!rewriteFinalization,
            rewriteManualHold,
          )
        ) {
          this.error.unprocessableEntity([
            'ویرایش سفارش در حال پرداخت مجاز نیست',
          ]);
        }

        // Status changes go through updateStatus; rewrite stays pending.
        if (dto.status != null && dto.status !== OrderStatus.pending) {
          this.error.unprocessableEntity([
            'برای تغییر وضعیت از مسیر وضعیت سفارش استفاده کنید',
          ]);
        }

        const currentOrderItems = await queryRunner.manager.find(
          OrderItemEntity,
          {
            where: { orderId },
            relations: ['product', 'productAttributeValue'],
          },
        );

        await this._deleteItemsAndRollbackQuantity(
          currentOrderItems,
          queryRunner,
        );

        // F1: existing Order FX snapshot is immutable on rewrite.
        // Do not call live TGJU; do not fabricate FX for legacy null snapshots.
        order.customerId = dto.customerId;
        order.amount = amount;
        order.discount = discount;
        order.shipping = shipping;
        order.tax = tax;
        order.finalAmount = finalAmount;
        order.description = dto.description;
        order.status = OrderStatus.pending;
        await queryRunner.manager.save(order);
      } else {
        // F1: fresh TGJU-backed rate only for NEW Order creation.
        const fxRate =
          await this.settingService.requireFreshAuthoritativeTryToToman();
        const fxCapturedAt = new Date();

        const createStatus = dto.status || OrderStatus.pending;
        if (createStatus !== OrderStatus.pending) {
          this.error.unprocessableEntity([
            'سفارش جدید باید در وضعیت در انتظار باشد',
          ]);
        }

        // Generating new order number with bounded retry on unique collision
        orderId = await this._insertOrderWithUniqueNumber(queryRunner, {
          customerId: customerId || dto.customerId,
          amount,
          discount,
          shipping,
          tax,
          finalAmount,
          commercialCurrency: ProductCurrency.TRY,
          fxRateToIrt: fxRate.tryToToman,
          fxCapturedAt,
          fxRateSource: fxRate.source || FX_RATE_SOURCE_TGJU,
          address: address.address,
          location: address.location,
          latitude: address.latitude ?? null,
          longitude: address.longitude ?? null,
          addressDetails: address.details,
          postalCode: address.postalCode,
          phone: address.phone,
          cityId: address.cityId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          sourceTrackingCode: null,
          description: dto.description,
          status: OrderStatus.pending,
          createdAt: new Date(),
        });
      }

      // insert to orderItems — cost measurement snapshot at create (F1)
      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(OrderItemEntity)
        .values(
          mixedItems.map((product) => {
            const costSnap = buildOrderItemCostSnapshot(
              resolveEffectiveCost(product, product.productAttributeValue),
            );
            return {
              orderId,
              productId: product.id,
              productAttributeValueId: product.productAttributeValue?.id || null,
              price: product.price,
              discountedPrice: product?.discountedPrice ?? 0,
              quantity: product.quantity,
              finalAmount:
                (product?.discountedPrice ?? product?.price ?? 0) *
                product.quantity,
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

      // atomically decrement stock
      for (let i = 0; i < mixedItems.length; i++) {
        const mixedItem = mixedItems[i];
        let decremented = false;

        if (mixedItem.productAttributeValue) {
          decremented = await this.productService.decrementAttributeQuantity(
            mixedItem.productAttributeValue.id,
            mixedItem.quantity,
            queryRunner,
          );
        } else {
          decremented = await this.productService.decrementQuantity(
            mixedItem.id,
            mixedItem.quantity,
            queryRunner,
          );
        }

        if (!decremented) {
          this.error.unprocessableEntity([
            'موجودی محصول درخواستی کافی نمی‌باشد',
          ]);
        }
      }

      await queryRunner.commitTransaction();
      return orderId;
    } catch (err) {
      await queryRunner.rollbackTransaction();

      if (err?.status) {
        throw err;
      }

      this.error.methodNotAllowed(['خطایی رخ داده است']);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * -------------------------------------------------------
   * GET /orders/admin
   */
  async getAllForAdmin(
    page = 1,
    limit = 20,
    filters = null,
    customer = null,
    sorts = null,
  ) {
    let builder = this.orderRepository
      .createQueryBuilder('order')
      .innerJoin('order.orderItems', 'orderItems')
      .leftJoin('order.customer', 'customer')

      .addSelect('orderItems.id')
      .addSelect('orderItems.quantity')
      .addSelect('customer.id')
      .addSelect('customer.firstName')
      .addSelect('customer.lastName');

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('order.createdAt', 'ASC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    if (customer) {
      builder.andWhere(
        `CONCAT(customer.firstName, ' ', customer.lastName) LIKE :customer`,
        {
          customer: `%${customer}%`,
        },
      );
    }

    const items = await builder
      .take(limit)
      .skip((page - 1) * limit)
      .getMany();

    const subQuery = builder
      .select([
        'order.id as orderId',
        'order.amount as amount',
        'order.discount as discount',
        // 'order.discountCoupon as discountCoupon',
        'order.shipping as shipping',
        'order.tax as tax',
        'order.finalAmount as finalAmount',
      ])
      .groupBy('order.id');
    const rawData = await getConnection()
      .createQueryBuilder()
      .select([
        'COUNT(sub.orderId) as totalItems',
        'SUM(sub.amount) as amount',
        'SUM(sub.discount) as discount',
        // 'SUM(sub.discountCoupon) as discountCoupon',
        'SUM(sub.shipping) as shipping',
        'SUM(sub.tax) as tax',
        'SUM(sub.finalAmount) as finalAmount',
      ])
      .from(`(${subQuery.getQuery()})`, 'sub')
      .setParameters(subQuery.getParameters())
      .getRawOne();

    return {
      items: items.map((item) => ({
        ...item,
        countItems:
          item.orderItems?.reduce((acc, item) => acc + item.quantity, 0) || 0,
      })),
      pagination: paginationResult(page, limit, +rawData.totalItems),
      sum: {
        amount: +rawData.amount || 0,
        discount: +rawData.discount || 0,
        // discountCoupon: +rawData.discountCoupon || 0,
        discountCoupon: 0,
        shipping: +rawData.shipping || 0,
        tax: +rawData.tax || 0,
        finalAmount: +rawData.finalAmount || 0,
      },
    };
  }

  /**
   * -------------------------------------------------------
   * GET /orders/me
   */
  async getAll(page = 1, limit = 20, filters = null, sorts = null, customerId) {
    let builder = this.orderRepository.createQueryBuilder('order');

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('order.createdAt', 'ASC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    builder.andWhere({ customerId });

    const [items, totalItems] = await builder
      .take(limit)
      .skip((page - 1) * limit)
      .getManyAndCount();

    return {
      items: items.map((item) => ({
        ...item,
        countItems:
          item.orderItems?.reduce((acc, item) => acc + item.quantity, 0) || 0,
      })),
      pagination: paginationResult(page, limit, totalItems),
    };
  }

  /**
   * -------------------------------------------------------
   * GET /orders/:id/admin
   */
  async getByIdForAdmin(id: number) {
    const builder = this.orderRepository
      .createQueryBuilder('order')

      .innerJoinAndSelect('order.orderItems', 'orderItems')
      .leftJoinAndSelect(
        'orderItems.productAttributeValue',
        'productAttributeValue',
      )
      .leftJoinAndSelect(
        'productAttributeValue.attributeValue',
        'attributeValue',
      )

      .leftJoinAndSelect('attributeValue.attribute', 'attribute')

      .leftJoinAndSelect('orderItems.product', 'product')

      .leftJoinAndSelect('product.cover', 'cover')

      .leftJoin('order.customer', 'customer')

      .addSelect('customer.id')
      .addSelect('customer.firstName')
      .addSelect('customer.lastName')
      .addSelect('customer.mobile')
      .addSelect('customer.email')

      .where({ id });

    const order = await builder.getOne();

    if (!order) {
      this.error.unprocessableEntity(['سفارش موردنظر پیدا نشد']);
    }

    return order;
  }

  /**
   * -------------------------------------------------------
   * GET /orders/me/:id
   */
  async getById(id: number, customerId, IP: string) {
    const builder = this.orderRepository
      .createQueryBuilder('order')
      .innerJoinAndSelect('order.orderItems', 'orderItems')

      .leftJoinAndSelect(
        'orderItems.productAttributeValue',
        'productAttributeValue',
      )
      .leftJoinAndSelect(
        'productAttributeValue.attributeValue',
        'attributeValue',
      )
      .leftJoinAndSelect('attributeValue.attribute', 'attribute')

      .leftJoin('orderItems.product', 'product')
      .leftJoinAndSelect('product.cover', 'cover')
      .addSelect('product.id')
      .addSelect('product.name')
      .where({ id });

    builder.andWhere({ customerId });

    const order = await builder.getOne();

    if (!order) {
      this.error.unprocessableEntity(['سفارش موردنظر پیدا نشد']);
    }

    return order;
  }

  /**
   * -------------------------------------------------------
   * PUT /orders/status/admin
   *
   * Phase C1: enforced lifecycle transitions. Rejecting a still-pending
   * unpaid order releases reserved inventory exactly once under order+tx
   * locks when financially safe. Paid/non-pending reject does not restore.
   */
  async updateStatus(dto: UpdateOrderStatusDto) {
    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const order = await queryRunner.manager.findOne(OrderEntity, {
        where: { id: dto.id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!order) {
        this.error.unprocessableEntity(['سفارش موردنظر پیدا نشد']);
      }

      assertOrderStatusTransition(order.status, dto.status, this.error);

      const releasingUnpaidReject =
        dto.status === OrderStatus.rejected &&
        isInventoryStillReserved(order.status);

      if (releasingUnpaidReject) {
        const transactions = await this.lockOrderTransactions(
          queryRunner,
          order.id,
        );
        const finalization = await queryRunner.manager.findOne(
          OrderPaymentFinalizationEntity,
          { where: { orderId: order.id } },
        );
        const manualHold = await this.hasActiveManualPaymentHold(
          queryRunner,
          order.id,
        );

        if (
          isInventoryReleaseBlocked(
            order,
            transactions,
            !!finalization,
            manualHold,
          )
        ) {
          this.error.methodNotAllowed([
            'آزادسازی موجودی سفارش دارای سابقه مالی مجاز نیست',
          ]);
        }

        const orderItems = await queryRunner.manager.find(OrderItemEntity, {
          where: { orderId: order.id },
        });
        await this.restoreReservedInventory(orderItems, queryRunner);
      }

      order.status = dto.status;

      if (dto.reasonRejected !== undefined) {
        order.reasonRejected = dto.reasonRejected;
      }
      if (dto.postTrackingCode !== undefined) {
        order.postTrackingCode = dto.postTrackingCode;
      }
      if (dto.sourceTrackingCode !== undefined) {
        order.sourceTrackingCode = dto.sourceTrackingCode;
      }

      const saved = await queryRunner.manager.save(order);
      await queryRunner.commitTransaction();
      return saved;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      if (err instanceof HttpException) {
        throw err;
      }
      this.error.methodNotAllowed(['خطایی رخ داده است']);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Hard-deletes an order and its transactions.
   * Phase 2B-3: blocked when financial history must be preserved.
   * Phase C1: pending unpaid orders restore reserved inventory exactly once
   * (product XOR PAV, mirroring create). Already-rejected orders do not
   * restore again. Reachable via DELETE /orders/:id/admin and cleanup.
   *
   * Lock order: Order row → Transactions by id ASC → (optional finalization).
   */
  async delete(id: number) {
    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const order = await queryRunner.manager.findOne(OrderEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!order) {
        this.error.unprocessableEntity(['سفارش موردنظر پیدا نشد']);
      }

      const transactions = await this.lockOrderTransactions(queryRunner, id);
      const finalization = await queryRunner.manager.findOne(
        OrderPaymentFinalizationEntity,
        { where: { orderId: id } },
      );
      const manualHold = await this.hasActiveManualPaymentHold(queryRunner, id);

      if (
        isOrderHardDeletionBlocked(
          order,
          transactions || [],
          !!finalization,
          manualHold,
        )
      ) {
        this.error.methodNotAllowed(['حذف سفارش دارای سابقه مالی مجاز نیست']);
      }

      const orderItems = await queryRunner.manager.find(OrderItemEntity, {
        where: { orderId: id },
      });

      if (isInventoryStillReserved(order.status)) {
        await this.restoreReservedInventory(orderItems, queryRunner);
      }

      for (let i = 0; i < orderItems.length; i++) {
        await queryRunner.manager.remove(orderItems[i]);
      }

      for (let i = 0; i < (transactions || []).length; i++) {
        await queryRunner.manager.remove(transactions[i]);
      }

      await queryRunner.manager.remove(order);
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      if (err instanceof HttpException) {
        throw err;
      }
      this.error.methodNotAllowed(['خطایی رخ داده است']);
    } finally {
      await queryRunner.release();
    }

    return true;
  }

  /**
   * Authoritative unpaid-reservation restore for a locked pending order.
   * Safe to call only while holding pessimistic_write on the order row and
   * only when {@link isInventoryStillReserved} is true for that row.
   */
  async restoreReservedInventory(
    orderItems: ReservedInventoryLine[],
    queryRunner: QueryRunner,
  ): Promise<void> {
    await restoreReservedInventoryLines(
      this.productService,
      orderItems,
      queryRunner,
    );
  }

  /**
   * Exactly-once unpaid release: lock order, restore iff still pending and
   * financially safe, then durably transition pending → rejected so a second
   * call cannot restore again without a new reservation.
   *
   * Lock order: Order → Transactions by id ASC.
   */
  async tryReleasePendingInventory(
    orderId: number,
    queryRunner: QueryRunner,
  ): Promise<InventoryReleaseOutcome> {
    const order = await queryRunner.manager.findOne(OrderEntity, {
      where: { id: orderId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!order) {
      return 'not_found';
    }

    if (!isInventoryStillReserved(order.status)) {
      return 'skipped_not_reserved';
    }

    const transactions = await this.lockOrderTransactions(queryRunner, orderId);
    const finalization = await queryRunner.manager.findOne(
      OrderPaymentFinalizationEntity,
      { where: { orderId } },
    );
    const manualHold = await this.hasActiveManualPaymentHold(
      queryRunner,
      orderId,
    );

    if (
      isInventoryReleaseBlocked(
        order,
        transactions,
        !!finalization,
        manualHold,
      )
    ) {
      return 'skipped_financially_preserved';
    }

    const orderItems = await queryRunner.manager.find(OrderItemEntity, {
      where: { orderId },
    });
    await this.restoreReservedInventory(orderItems, queryRunner);
    order.status = OrderStatus.rejected;
    await queryRunner.manager.save(order);
    return 'released';
  }

  /**
   * Lock all transactions for an order in stable id order (after order lock).
   */
  private async lockOrderTransactions(
    queryRunner: QueryRunner,
    orderId: number,
  ): Promise<TransactionEntity[]> {
    return queryRunner.manager
      .createQueryBuilder(TransactionEntity, 'tx')
      .setLock('pessimistic_write')
      .where('tx.orderId = :orderId', { orderId })
      .orderBy('tx.id', 'ASC')
      .getMany();
  }

  /**
   * C2A: active SUBMITTED/UNDER_REVIEW hold with future holdExpiresAt.
   */
  private async hasActiveManualPaymentHold(
    queryRunner: QueryRunner,
    orderId: number,
  ): Promise<boolean> {
    const now = new Date();
    const row = await queryRunner.manager
      .createQueryBuilder(PaymentSubmissionEntity, 'ps')
      .where('ps.orderId = :orderId', { orderId })
      .andWhere('ps.purpose = :purpose', {
        purpose: PaymentSubmissionPurpose.ORDER_PAYMENT,
      })
      .andWhere('ps.status IN (:...statuses)', {
        statuses: ACTIVE_MANUAL_PAYMENT_HOLD_STATUSES,
      })
      .andWhere('ps.holdExpiresAt > :now', { now })
      .orderBy('ps.id', 'DESC')
      .getOne();

    return hasActiveOrderPaymentHold(row, now);
  }

  /**
   * -------------------------------------------------------
   */
  async deleteByCustomerId(customerId: number) {
    const orders = await this.orderRepository.find({ customerId });

    for (let i = 0; i < orders.length; i++) {
      await this.delete(orders[i].id);
    }

    return true;
  }

  /**
   * Atomically mark order paid. Returns whether this call performed the transition.
   */
  async markOrderPaidAtomic(
    orderId: number,
    queryRunner: QueryRunner,
    successfulTransactionId?: number,
  ): Promise<'newly_paid' | 'already_paid' | 'not_found' | 'invalid_state'> {
    const updatePayload: Partial<OrderEntity> = { status: OrderStatus.paid };
    if (successfulTransactionId != null) {
      updatePayload.successfulTransactionId = successfulTransactionId;
    }

    const updateResult = await queryRunner.manager
      .createQueryBuilder()
      .update(OrderEntity)
      .set(updatePayload)
      .where('id = :id AND status IN (:...statuses)', {
        id: orderId,
        statuses: ORDER_COMPLETABLE_STATES,
      })
      .execute();

    if (updateResult.affected > 0) {
      return 'newly_paid';
    }

    const order = await queryRunner.manager.findOne(OrderEntity, {
      where: { id: orderId },
      select: ['id', 'status'],
    });

    if (!order) {
      return 'not_found';
    }

    if (isOrderAlreadyPaid(order.status)) {
      return 'already_paid';
    }

    return 'invalid_state';
  }

  /**
   * DB-enforced one-successful-finalization-per-order claim.
   */
  async claimOrderPaymentFinalization(
    orderId: number,
    transactionId: number,
    queryRunner: QueryRunner,
  ): Promise<OrderPaymentClaimResult> {
    await queryRunner.manager.findOne(OrderEntity, {
      where: { id: orderId },
      lock: { mode: 'pessimistic_write' },
    });

    try {
      await queryRunner.manager.insert(OrderPaymentFinalizationEntity, {
        orderId,
        transactionId,
        finalizedAt: new Date(),
      });
      return 'claimed';
    } catch (err) {
      if (err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062) {
        const existing = await queryRunner.manager.findOne(
          OrderPaymentFinalizationEntity,
          { where: { orderId } },
        );

        if (existing?.transactionId === transactionId) {
          return 'same_transaction';
        }

        return 'other_transaction';
      }

      throw err;
    }
  }

  /**
   * Complete order payment after financial writes for the winning transaction.
   */
  async finalizeOrderPaymentAtomic(
    orderId: number,
    transactionId: number,
    queryRunner: QueryRunner,
  ): Promise<'finalized' | 'idempotent' | 'superseded'> {
    const claim = await this.claimOrderPaymentFinalization(
      orderId,
      transactionId,
      queryRunner,
    );

    if (claim === 'other_transaction') {
      return 'superseded';
    }

    const paymentResult = await this.markOrderPaidAtomic(
      orderId,
      queryRunner,
      transactionId,
    );

    if (claim === 'same_transaction') {
      return 'idempotent';
    }

    if (paymentResult === 'newly_paid') {
      await this.recognizeCogsFromOrderItemSnapshots(orderId, queryRunner);
      await this.applyReferralRewardsAtomic(orderId, queryRunner);
      return 'finalized';
    }

    if (paymentResult === 'already_paid') {
      return 'idempotent';
    }

    this.error.unprocessableEntity(['این سفارش قابل پرداخت نمی‌باشد']);
  }

  /**
   * F1: COGS recognition from OrderItem snapshots only (never re-read Product).
   * If any line lacks landed cost → incomplete_missing_cogs; no aggregate COGS event.
   */
  async recognizeCogsFromOrderItemSnapshots(
    orderId: number,
    queryRunner: QueryRunner,
  ): Promise<void> {
    const order = await queryRunner.manager.findOne(OrderEntity, {
      where: { id: orderId },
    });
    if (!order) {
      return;
    }

    const now = new Date();
    await queryRunner.manager
      .createQueryBuilder()
      .update(OrderEntity)
      .set({ financialConfirmedAt: now })
      .where('id = :id AND financialConfirmedAt IS NULL', { id: orderId })
      .execute();

    const items = await queryRunner.manager.find(OrderItemEntity, {
      where: { orderId },
    });

    const normalized = normalizeOrderCogsToIrt(items, order.fxRateToIrt);

    if (!normalized.ok) {
      await queryRunner.manager
        .createQueryBuilder()
        .update(OrderEntity)
        .set({
          profitabilityStatus: ProfitabilityStatus.incomplete_missing_cogs,
        })
        .where('id = :id', { id: orderId })
        .execute();
      return;
    }

    await this.financialEventService.insertIdempotent(queryRunner, {
      eventType: FinancialEventType.ORDER_COGS_RECOGNIZED,
      amount: normalized.totalIrt,
      currency: ProductCurrency.IRT,
      amountIrt: normalized.totalIrt,
      fxRateToIrt: normalized.fxRateToIrt,
      orderId,
      sourceType: 'order_payment_finalization',
      sourceId: String(orderId),
      idempotencyKey: `opf:${orderId}:ORDER_COGS_RECOGNIZED`,
      metadata: {
        lineCount: normalized.lineCount,
        reportingCurrency: ProductCurrency.IRT,
      },
      occurredAt: now,
    });

    await queryRunner.manager
      .createQueryBuilder()
      .update(OrderEntity)
      .set({ profitabilityStatus: ProfitabilityStatus.complete })
      .where('id = :id', { id: orderId })
      .execute();
  }

  /**
   * Idempotent referral reward application tied to durable ledger row.
   */
  async applyReferralRewardsAtomic(
    orderId: number,
    queryRunner: QueryRunner,
  ): Promise<void> {
    const order = await queryRunner.manager.findOne(OrderEntity, {
      where: { id: orderId },
      relations: ['customer'],
    });

    if (!order?.customer?.inviteCode) {
      return;
    }

    const referrerCustomer = await queryRunner.manager
      .createQueryBuilder(CustomerEntity, 'customer')
      .where('customer.referrerCode = :code', {
        code: order.customer.inviteCode,
      })
      .getOne();

    if (!referrerCustomer) {
      return;
    }

    const setting = await queryRunner.manager.findOne(SettingEntity, {
      where: { id: 1 },
    });

    if (!setting) {
      return;
    }

    const orderAmount = order.amount - order.discount;

    const buyPercentToReferrerCreditUSD =
      referrerCustomer.buyPercentToReferrerCreditUSD ??
      setting.buyPercentToReferrerCreditUSD;

    const buyPercentToReferrerCreditIRT =
      referrerCustomer.buyPercentToReferrerCreditIRT ??
      setting.buyPercentToReferrerCreditIRT;

    const buyPercentToReferrerCreditTRY =
      referrerCustomer.buyPercentToReferrerCreditTRY ??
      setting.buyPercentToReferrerCreditTRY;

    const walletUSD =
      buyPercentToReferrerCreditUSD > 0
        ? (buyPercentToReferrerCreditUSD * orderAmount) / 100
        : 0;
    const walletIRT =
      buyPercentToReferrerCreditIRT > 0
        ? (buyPercentToReferrerCreditIRT * orderAmount) / 100
        : 0;
    const walletTRY =
      buyPercentToReferrerCreditTRY > 0
        ? (buyPercentToReferrerCreditTRY * orderAmount) / 100
        : 0;

    const boundedWalletUSD = this._boundReferralAmount(walletUSD);
    const boundedWalletIRT = this._boundReferralAmount(walletIRT);
    const boundedWalletTRY = this._boundReferralAmount(walletTRY);

    if (
      boundedWalletUSD === 0 &&
      boundedWalletIRT === 0 &&
      boundedWalletTRY === 0
    ) {
      return;
    }

    let awardId: number | null = null;
    try {
      const insertResult = await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(ReferralAwardEntity)
        .values({
          orderId: order.id,
          referrerCustomerId: referrerCustomer.id,
          referredCustomerId: order.customerId,
          walletUSD: boundedWalletUSD,
          walletIRT: boundedWalletIRT,
          walletTRY: boundedWalletTRY,
          createdAt: new Date(),
        })
        .execute();
      awardId = insertResult.identifiers?.[0]?.id ?? null;
    } catch (err) {
      if (err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062) {
        return;
      }
      throw err;
    }

    if (boundedWalletUSD > 0) {
      await queryRunner.manager.increment(
        CustomerEntity,
        { id: referrerCustomer.id },
        'walletUSD',
        boundedWalletUSD,
      );
    }

    if (boundedWalletIRT > 0) {
      await queryRunner.manager.increment(
        CustomerEntity,
        { id: referrerCustomer.id },
        'walletIRT',
        boundedWalletIRT,
      );
    }

    if (boundedWalletTRY > 0) {
      await queryRunner.manager.increment(
        CustomerEntity,
        { id: referrerCustomer.id },
        'walletTRY',
        boundedWalletTRY,
      );
    }

    if (boundedWalletUSD > 0) {
      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into('wallet_history')
        .values({
          walletUSD: boundedWalletUSD,
          customerId: referrerCustomer.id,
          type: WalletHistoryType.buy,
          relatedCustomerId: order.customerId,
          relatedOrderId: order.id,
          createdAt: new Date(),
        })
        .execute();
    }

    if (boundedWalletIRT > 0) {
      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into('wallet_history')
        .values({
          walletIRT: boundedWalletIRT,
          customerId: referrerCustomer.id,
          type: WalletHistoryType.buy,
          relatedCustomerId: order.customerId,
          relatedOrderId: order.id,
          createdAt: new Date(),
        })
        .execute();
    }

    if (boundedWalletTRY > 0) {
      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into('wallet_history')
        .values({
          walletTRY: boundedWalletTRY,
          customerId: referrerCustomer.id,
          type: WalletHistoryType.buy,
          relatedCustomerId: order.customerId,
          relatedOrderId: order.id,
          createdAt: new Date(),
        })
        .execute();
    }

    // F1: financial event for IRT commission magnitude (primary reporting currency).
    if (awardId != null && boundedWalletIRT > 0) {
      await this.financialEventService.insertIdempotent(queryRunner, {
        eventType: FinancialEventType.REFERRAL_COMMISSION_EARNED,
        amount: boundedWalletIRT,
        currency: ProductCurrency.IRT,
        amountIrt: boundedWalletIRT,
        orderId: order.id,
        customerId: referrerCustomer.id,
        referralAwardId: awardId,
        sourceType: 'referral_award',
        sourceId: String(awardId),
        idempotencyKey: `referral_award:${awardId}:REFERRAL_COMMISSION_EARNED`,
        metadata: {
          walletUSD: boundedWalletUSD,
          walletTRY: boundedWalletTRY,
          walletIRT: boundedWalletIRT,
        },
      });
    }
  }

  /**
   * Side effects only — must run outside critical financial transactions.
   */
  async sendPostPaymentNotifications(orderId: number): Promise<void> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['customer'],
    });

    if (!order) {
      return;
    }

    this.telegrafBotService.sendNotification(
      `✅ سفارش جدید\n💰 ${digit(order.finalAmount)} تومان\n\n👱🏻‍♂️ ${
        order.customer.firstName || ''
      } ${order.customer.lastName || ''}\n📞 ${order.customer.mobile}`,
    );

    const award = await this.referralAwardRepository.findOne({
      where: { orderId },
    });

    if (!award) {
      return;
    }

    const referrerCustomer = await this.customerService.getActiveById(
      award.referrerCustomerId,
    );

    if (!referrerCustomer) {
      return;
    }

    if (award.walletUSD > 0) {
      this.telegrafBotService.sendNotification(
        `💌 اعتبار به معرف\n💰 ${award.walletUSD} دلار\n\n👱🏻‍♂️ ${
          referrerCustomer.firstName || ''
        } ${referrerCustomer.lastName || ''}\n📞 ${referrerCustomer.mobile}`,
      );
    }

    if (award.walletIRT > 0) {
      this.telegrafBotService.sendNotification(
        `💌 اعتبار به معرف\n💰 ${digit(award.walletIRT)} تومان\n\n👱🏻‍♂️ ${
          referrerCustomer.firstName || ''
        } ${referrerCustomer.lastName || ''}\n📞 ${referrerCustomer.mobile}`,
      );
    }

    if (award.walletTRY > 0) {
      this.telegrafBotService.sendNotification(
        `💌 اعتبار به معرف\n💰 ${award.walletTRY} لیر\n\n👱🏻‍♂️ ${
          referrerCustomer.firstName || ''
        } ${referrerCustomer.lastName || ''}\n📞 ${referrerCustomer.mobile}`,
      );
    }
  }

  /**
   * Admin manual settlement — uses the same finalization invariant as gateway/wallet.
   */
  async settleOrderManuallyAtomic(
    orderId: number,
  ): Promise<'finalized' | 'idempotent'> {
    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let notify = false;

    try {
      const order = await queryRunner.manager.findOne(OrderEntity, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!order) {
        this.error.unprocessableEntity(['سفارش موردنظر پیدا نشد']);
      }

      if (isOrderAlreadyPaid(order.status)) {
        await queryRunner.commitTransaction();
        return 'idempotent';
      }

      const gateway = await queryRunner.manager.findOne(GatewayEntity, {
        where: { status: GatewayStatus.active, isDeleted: false },
      });

      if (!gateway) {
        this.error.unprocessableEntity(['درگاه پرداخت فعال یافت نشد']);
      }

      let settlement;
      try {
        settlement = computeSettlementFromOrderSnapshot(order);
      } catch (e) {
        if (e?.message === 'order_fx_snapshot_missing') {
          this.error.unprocessableEntity(
            ['نرخ ارز سفارش موجود نیست. امکان تسویه وجود ندارد.'],
            { code: 'order_fx_snapshot_missing' },
          );
        }
        throw e;
      }

      const { identifiers } = await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(TransactionEntity)
        .values({
          orderId: order.id,
          customerId: order.customerId,
          gatewayId: gateway.id,
          amount: settlement.settlementAmount,
          settlementCurrency: settlement.settlementCurrency,
          fxRateToIrt: settlement.fxRateToIrt,
          commercialAmount: settlement.commercialAmount,
          commercialCurrency: settlement.commercialCurrency,
          walletAmount: 0,
          walletIRT: 0,
          walletTRY: 0,
          walletUSD: 0,
          reduceCardAmount: 0,
          status: TransactionStatus.paid,
          paymentSource: TransactionPaymentSource.manual,
          referenceNumber: `MANUAL-${order.id}-${Date.now()}`,
          message: 'manual_admin_settlement',
          paidAt: new Date(),
          ip: '127.0.0.1',
          createdAt: new Date(),
        })
        .execute();

      const manualTransactionId = identifiers[0].id;

      const finalizeResult = await this.finalizeOrderPaymentAtomic(
        order.id,
        manualTransactionId,
        queryRunner,
      );

      if (finalizeResult === 'superseded') {
        this.error.unprocessableEntity(['این سفارش قبلاً پرداخت شده است']);
      }

      await queryRunner.commitTransaction();
      notify = finalizeResult === 'finalized';
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    if (notify) {
      await this.sendPostPaymentNotifications(orderId);
    }

    return notify ? 'finalized' : 'idempotent';
  }

  private _boundReferralAmount(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
      return 0;
    }
    return Math.round(value * 100) / 100;
  }

  private async _insertOrderWithUniqueNumber(
    queryRunner: QueryRunner,
    value: Record<string, unknown>,
    maxAttempts = 5,
  ): Promise<number> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const generatedNumber = await this._generateOrderNumber(
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

  /**
   * -------------------------------------------------------
   */
  private async _generateOrderNumber(
    queryRunner?: QueryRunner,
    collisionOffset = 0,
  ): Promise<string> {
    const manager = queryRunner?.manager ?? this.orderRepository.manager;
    const orderNumber = moment().locale('fa').format('YYYYMM');

    const lastOrder = await manager
      .createQueryBuilder(OrderEntity, 'order')
      .orderBy('order.id', 'DESC')
      .getOne();

    if (!lastOrder) {
      return `${orderNumber}${1 + collisionOffset}`;
    }

    const lastCounter = +lastOrder.number.substring(6) || 0;

    return `${orderNumber}${lastCounter + 1 + collisionOffset}`;
  }

  /**
   * -------------------------------------------------------
   * show chart of orders
   * GET /orders/statistic/chart/admin
   */
  async statisticChart(from, to, type = 'daily', section) {
    const builder = this.orderRepository
      .createQueryBuilder()
      .groupBy('DAY(createdAt), MONTH(createdAt)')
      .select([
        'SUM(finalAmount) AS sumFinalAmount',
        'DAY(createdAt) AS day',
        'MONTH(createdAt) AS month',
        'DATE(createdAt) AS date',
      ])
      .andWhere('status IN (:...statuses)', {
        statuses: [OrderStatus.paid, OrderStatus.sent, OrderStatus.delivered],
      })
      .andWhere('DATE(createdAt) BETWEEN :from AND :to', {
        from,
        to,
      })

      .orderBy('createdAt', 'ASC');

    if (section === 'online') {
      builder.andWhere('tableId IS NULL');
    } else if (section === 'in_restaurant') {
      builder.andWhere('tableId IS NOT NULL');
    }

    const list = await builder.getRawMany();

    const mapping = list.map((item) => ({
      sum: +item.sumFinalAmount || +item.sumCalFinalAmount,
      label: moment(item.date).locale('fa').format('D (ddd)'),
      date: item.date,
    }));

    if (type === 'daily') {
      return mapping;
    }

    const obj = {};
    mapping.forEach((item) => {
      const m = moment(item.date).locale('fa').format('M');

      obj[+m] = {
        label: moment(item.date).locale('fa').format('MMMM'),
        month: +m,
        sum: (obj[+m]?.sum || 0) + item.sum,
      };
    });

    return Object.values(obj).sort((a: any, b: any) => a.month - b.month);
  }

  /**
   * -------------------------------------------------------
   * Show count of orders
   * GET /orders/statistic/count/admin
   */
  async statisticCount(onlyPending = false, from = null, to = null) {
    const builder = this.orderRepository
      .createQueryBuilder('order')
      .select([
        `SUM(IF(order.status = '${OrderStatus.pending}', 1, 0)) AS pending`,
        ...(!onlyPending
          ? [
              `SUM(IF(order.status = '${OrderStatus.accepted}', 1, 0)) AS accepted`,
              `SUM(IF(order.status = '${OrderStatus.rejected}', 1, 0)) AS rejected`,
              `SUM(IF(order.status = '${OrderStatus.paid}', 1, 0)) AS paid`,
              `SUM(IF(order.status = '${OrderStatus.sent}', 1, 0)) AS sent`,
              `SUM(IF(order.status = '${OrderStatus.delivered}', 1, 0)) AS delivered`,
            ]
          : []),
      ]);

    if (from && to) {
      builder.andWhere('DATE(order.createdAt) BETWEEN :from AND :to', {
        from,
        to,
      });
    }

    const { pending, accepted, rejected, unpaid, sent, delivered } =
      await builder.getRawOne();

    return {
      pending: +pending,
      accepted: +accepted,
      rejected: +rejected,
      unpaid: +unpaid,
      sent: +sent,
      delivered: +delivered,
    };
  }

  /**
   * -------------------------------------------------------
   */
  async statisticBestSalesByProduct(from = null, to = null) {
    const builder = this._statisticBestSalesBuilder(from, to);

    builder.groupBy('product.id').addSelect('product.id AS id');

    return await builder.getRawMany();
  }

  /**
   * -------------------------------------------------------
   */
  async statisticBestSalesByCategory(from = null, to = null) {
    const builder = this._statisticBestSalesBuilder(from, to);

    builder
      .innerJoin('product.category', 'category')
      .groupBy('category.id')
      .addSelect('category.id AS id');

    return await builder.getRawMany();
  }

  /**
   * -------------------------------------------------------
   */
  private _statisticBestSalesBuilder(from = null, to = null) {
    const builder = this.orderRepository
      .createQueryBuilder('order')
      .innerJoin('order.orderItems', 'orderItems')
      .innerJoin('orderItems.product', 'product')
      .select(['SUM(orderItems.quantity) AS count', 'product.name AS name'])
      .andWhere('order.status IN (:...statuses)', {
        statuses: [OrderStatus.paid, OrderStatus.sent, OrderStatus.delivered],
      })
      .orderBy('count', 'DESC')
      .limit(5);

    if (from && to) {
      builder.andWhere('DATE(order.createdAt) BETWEEN :from AND :to', {
        from,
        to,
      });
    }

    return builder;
  }

  /**
   * -------------------------------------------------------
   */
  async getRecordById(id: number, relations = null, customerId: number = null) {
    const where: any = { id };
    if (customerId != null) {
      where.customerId = customerId;
    }

    return await this.orderRepository.findOne({
      where,
      ...(relations !== null && relations),
    });
  }

  /**
   * -------------------------------------------------------
   * Deleting unpaid pending orders after configured timeout.
   * Phase C1: ENV-driven timeout + bounded batch, per-order isolation,
   * inventory release via delete() (exactly-once while pending).
   *
   * Candidate SQL excludes rows with financial-preservation evidence so
   * protected prefixes cannot starve later eligible orders across cron runs.
   * In-run keyset (createdAt, id) still progresses past transient delete
   * failures within one invocation. Final delete() re-checks under locks.
   */
  async handleDeleteUnpaid() {
    const config = loadUnpaidOrderCleanupConfig();
    const pastTime = moment()
      .subtract(config.timeoutHours, 'hours')
      .toDate();

    const maxRelease = config.batchSize;
    /** Scan budget among already-eligible candidates (not protected rows). */
    const maxScan = config.batchSize * 10;
    const pageSize = config.batchSize;

    let released = 0;
    let failed = 0;
    let scanned = 0;
    let cursorCreatedAt: Date | null = null;
    let cursorId: number | null = null;

    while (released < maxRelease && scanned < maxScan) {
      const take = Math.min(pageSize, maxScan - scanned);
      const qb = this.orderRepository
        .createQueryBuilder('o')
        .select(['o.id', 'o.createdAt'])
        .where('o.status = :status', { status: OrderStatus.pending })
        .andWhere('o.createdAt < :pastTime', { pastTime })
        .andWhere('o.successfulTransactionId IS NULL')
        .andWhere(
          `NOT EXISTS (
            SELECT 1 FROM order_payment_finalization f
            WHERE f.orderId = o.id
          )`,
        )
        .andWhere(
          `NOT EXISTS (
            SELECT 1 FROM transaction t
            WHERE t.orderId = o.id
              AND (
                t.status IN (:...preservedStatuses)
                OR t.paidAt IS NOT NULL
              )
          )`,
          {
            preservedStatuses: FINANCIALLY_PRESERVED_TRANSACTION_STATUSES,
          },
        )
        .andWhere(
          `NOT EXISTS (
            SELECT 1 FROM payment_submission ps
            WHERE ps.orderId = o.id
              AND ps.purpose = 'ORDER_PAYMENT'
              AND ps.status IN ('SUBMITTED','UNDER_REVIEW')
              AND ps.holdExpiresAt > NOW()
          )`,
        )
        .orderBy('o.createdAt', 'ASC')
        .addOrderBy('o.id', 'ASC')
        .take(take);

      if (cursorCreatedAt != null && cursorId != null) {
        qb.andWhere(
          '(o.createdAt > :cAt OR (o.createdAt = :cAt AND o.id > :cId))',
          { cAt: cursorCreatedAt, cId: cursorId },
        );
      }

      const page = await qb.getMany();
      if (page.length === 0) {
        break;
      }

      for (const order of page) {
        scanned += 1;
        try {
          await this.delete(order.id);
          released += 1;
        } catch {
          failed += 1;
        }

        cursorCreatedAt = order.createdAt;
        cursorId = order.id;

        if (released >= maxRelease || scanned >= maxScan) {
          break;
        }
      }

      if (page.length < take) {
        break;
      }
    }

    return {
      processed: scanned,
      released,
      failed,
    };
  }

  /**
   * -------------------------------------------------------
   * Admin order rewrite: restore old lines then remove them.
   * Caller must prove the order currently owns an active reservation
   * (pending + financially releasable) before invoking.
   * Uses the same XOR restore rule as unpaid release.
   */
  private async _deleteItemsAndRollbackQuantity(
    orderItems: OrderItemEntity[],
    queryRunner: QueryRunner,
  ) {
    await this.restoreReservedInventory(orderItems, queryRunner);

    for (let i = 0; i < orderItems.length; i++) {
      await queryRunner.manager.remove(orderItems[i]);
    }
  }
}
