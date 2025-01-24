import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as moment from 'jalali-moment';
import { getConnection, Repository, LessThan } from 'typeorm';
import { ErrorService } from '../../error/error.service';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  decryptByPassword,
  encryptByPassword,
  paginationResult,
} from '../../utils';

import { ProductService } from '../product/product.service';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderEntity, OrderStatus } from './entities/order.entity';
import { MailService } from '../../mail/mail.service';
// import { AmootsmsService } from '../../sms/amootsms/amootsms.service';
// import { KavenegarService } from '../../sms/kavenegar/kavenegar.service';
import { ProductType } from '../product/entities/product.entity';
import { ConfigurationService } from '../../config/configuration.service';
import { KavenegarService } from '../../sms/kavenegar/kavenegar.service';
import { DiscountCouponService } from '../discount-coupon/discount-coupon.service';
import { CustomerService } from '../customer/customer.service';
// import { CreateOrderDto } from './dto/create-order.dto';
// import { CreateOrderByAdminDto } from './dto/create-order-by-admin.dto';

@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(OrderEntity)
    private orderRepository: Repository<OrderEntity>,

    @InjectRepository(OrderItemEntity)
    private orderItemRepository: Repository<OrderItemEntity>,

    private config: ConfigurationService,
    private mail: MailService,
    private productService: ProductService,
    // private amootsmsService: AmootsmsService,
    private kavenegarService: KavenegarService,
    private error: ErrorService,
    private discountCouponService: DiscountCouponService,
    private customerService: CustomerService,
  ) {}

  /**
   * -------------------------------------------------------
   */
  async addUpdate(
    dto: any, // CreateOrderDto | CreateOrderByAdminDto | UpdateOrderByAdminDto
    customerId: number = null,
    orderId: number = null,
  ) {
    // Checking the customer by admin
    if (dto.customerId) {
      if (!(await this.customerService.getActiveById(dto.customerId))) {
        this.error.unprocessableEntity([
          't.The customer was not found or her account is disabled!',
        ]);
      }
    }

    // Checking the order by orderId
    let order: OrderEntity;
    if (orderId) {
      order = await this.orderRepository.findOne({
        where: {
          id: orderId,
        },
        relations: [
          'orderItems',
          'orderItems.product',
          'orderItems.productAttributeValue',
        ],
      });
      if (!order) {
        this.error.unprocessableEntity(['t.The request is invalid!']);
      }
      // Removing the old items and rollback quantity
      await this._deleteItemsAndRollbackQuantity(order.orderItems);
    }

    // get products from DB
    const products = await this.productService.findByIds(
      dto.productItems.map((item) => item.productId),
    );

    // merge product items with product from db
    const mixedItems = [];
    dto.productItems.forEach((cartItem) => {
      const fromDb = products.find(
        (product) => product.id === cartItem.productId,
      );

      if (!fromDb) {
        this.error.unprocessableEntity(['محصول مورد نظر یافت نشد!']);
      }

      const productAttributeValue = fromDb.productAttributeValues.find(
        (pav) => pav.id === cartItem.productAttributeValueId,
      );

      // checking product attribute quantity
      if (
        productAttributeValue &&
        productAttributeValue.quantity !== -1 &&
        cartItem.quantity > productAttributeValue.quantity
      ) {
        this.error.unprocessableEntity([
          't.There is not enough product stock!',
        ]);
      }

      // checking product quantity, if not exist productAttributeValue
      if (
        !productAttributeValue &&
        fromDb.quantity !== -1 &&
        cartItem.quantity > fromDb.quantity
      ) {
        this.error.unprocessableEntity([
          't.There is not enough product stock!',
        ]);
      }

      mixedItems.push({
        ...fromDb,
        stockQuantity: fromDb.quantity,
        price: cartItem.price || productAttributeValue?.price || fromDb.price,
        discountedPrice: cartItem.price
          ? 0
          : productAttributeValue?.discountedPrice ||
            fromDb?.discountedPrice ||
            0,
        quantity: cartItem.quantity,
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
          (mixedItem?.discountedPrice || mixedItem?.price || 0)) *
          mixedItem.quantity,
      0,
    );

    // Calculating amount after doing discount
    let itemsAmount = amount - discount;

    // discount coupon on amount
    let coupon = null;
    if (customerId && dto.discountCouponCode) {
      coupon = await this.discountCouponService.calculateDiscountByCouponCode(
        dto.discountCouponCode,
        itemsAmount,
        customerId,
        true,
      );
    }
    itemsAmount -= coupon?.discountAmount || 0;

    // // Calculating tax by vat
    // let tax = 0;
    // if (company.vat) {
    //   tax = (company.vat * itemsAmount) / 100;
    // }
    const tax = 0;

    // Calculating final amount
    const shipping = dto.shipping !== undefined ? dto.shipping || 0 : 0;

    const finalAmount = itemsAmount + shipping + tax;

    // Updating the order
    if (order) {
      order.customerId = dto.customerId;
      order.amount = amount;
      order.discount = discount;
      order.shipping = shipping;
      order.tax = tax;
      order.finalAmount = finalAmount;
      order.description = dto.description;
      order.address = dto.address;
      order.status = dto.status;
      order.updatedAt = new Date();
      await order.save();
    }

    // Creating the new order
    else {
      // Generating new order number
      const generatedNumber = await this._generateOrderNumber();

      // Inserting into order
      const { identifiers } = await this.orderRepository
        .createQueryBuilder()
        .insert()
        .values({
          customerId: customerId || dto.customerId,
          number: generatedNumber,
          amount,
          discount,
          shipping,
          tax,
          finalAmount,
          // discountCoupon: coupon?.discountAmount || 0,
          // discountCouponUsedId: coupon?.usedId || null,
          description: dto.description,
          address: dto.address,
          status: dto.status || OrderStatus.pending,
          createdAt: new Date(),
        })
        .execute();

      orderId = identifiers[0].id;
    }

    // insert to orderItems
    await this.orderItemRepository
      .createQueryBuilder()
      .insert()
      .values(
        mixedItems.map((product) => ({
          orderId,
          productId: product.id,
          productAttributeValueId: product.productAttributeValue?.id || null,
          price: product.price,
          discountedPrice: product?.discountedPrice || 0,
          quantity: product.quantity,
          finalAmount:
            (product?.discountedPrice || product?.price || 0) *
            product.quantity,
          createdAt: new Date(),
        })),
      )
      .execute();

    // update product quantity
    for (let i = 0; i < mixedItems.length; i++) {
      const mixedItem = mixedItems[i];

      // update productAttributeValue stock quantity
      if (mixedItem.productAttributeValue) {
        if (mixedItem.productAttributeValue.quantity !== -1) {
          await this.productService.updateAttributeQuantity(
            mixedItem.productAttributeValue.id,
            mixedItem.productAttributeValue.quantity - mixedItem.quantity,
          );
        }
      }
      // update product stock quantity
      else if (mixedItem.stockQuantity !== -1) {
        await this.productService.updateQuantity(
          mixedItem.id,
          mixedItem.stockQuantity - mixedItem.quantity,
        );
      }
    }

    return orderId;
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
        'order.discountCoupon as discountCoupon',
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
        'SUM(sub.discountCoupon) as discountCoupon',
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
        discountCoupon: +rawData.discountCoupon || 0,
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
      this.error.unprocessableEntity(['t.The order not found!']);
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
      .leftJoin('product.service', 'service')
      .leftJoinAndSelect('product.productFiles', 'productFiles')

      .leftJoinAndSelect('product.cover', 'cover')

      .addSelect('product.id')
      .addSelect('product.type')
      .addSelect('service.id')
      .addSelect('service.type')
      .addSelect('service.messageAfterPurchase')
      .where({ id });

    builder.andWhere({ customerId });

    const order = await builder.getOne();

    if (!order) {
      this.error.unprocessableEntity(['t.The order not found!']);
    }

    return order;
  }

  /**
   * -------------------------------------------------------
   * PUT /orders/status/admin
   */
  async updateStatus(dto: UpdateOrderStatusDto) {
    const order = await this.orderRepository.findOne({
      where: { id: dto.id },
    });

    if (!order) {
      this.error.unprocessableEntity(['t.The order not found!']);
    }

    order.status = dto.status;

    if (dto.reasonRejected !== undefined) {
      order.reasonRejected = dto.reasonRejected;
    }
    return await order.save();
  }

  /**
   * -------------------------------------------------------
   * DELETE /orders/:id/admin
   */
  async delete(id: number) {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: ['orderItems', 'orderItems.product', 'transactions'],
    });

    if (!order) {
      this.error.unprocessableEntity(['t.The order not found!']);
    }

    // Rollbacking the orderItems if an error occurs
    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      for (let i = 0; i < order.orderItems.length; i++) {
        const orderItem = order.orderItems[i];

        // Rollback the product quantity
        if (orderItem.product.quantity !== -1) {
          orderItem.product.quantity =
            orderItem.product.quantity + orderItem.quantity;
          await queryRunner.manager.save(orderItem.product);
        }

        // Removing the orderItem
        await queryRunner.manager.remove(orderItem);
      }

      for (let i = 0; i < order.transactions.length; i++) {
        const transaction = order.transactions[i];
        // Removing the transaction
        await queryRunner.manager.remove(transaction);
      }

      // Removing the order
      await queryRunner.manager.remove(order);

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();

      this.error.methodNotAllowed(['t.An error has occurred!']);
    } finally {
      await queryRunner.release();
    }

    return true;
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
   * -------------------------------------------------------
   */
  async complete(orderId: number) {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: [
        'customer',
        'orderItems',
        'orderItems.product',
        'orderItems.product.service',
      ],
    });

    order.status = OrderStatus.paid;
    await order.save();

    // if (email) {
    //   try {
    //     const resultMail = await this.mail.sendNewOrderToAdmin({
    //       to: email,
    //       data: {
    //         amount: order.finalAmount,
    //         number: order.number,
    //         currency: company.defaultCurrency,
    //         companyName: company.locales?.[0]?.name || null,
    //         companyLang: company.defaultLanguage,
    //       },
    //     });
    //     console.log('SUCCESS ORDER MAIL', { orderId }, email, resultMail);
    //   } catch (e) {
    //     console.log('ERROR ORDER MAIL', { orderId }, email, e);
    //   }
    // }

    // // Sending SMS
    // let finalAmount = order.finalAmount;
    // if (company.defaultCurrency === Currencies.IRR) {
    //   finalAmount = parseInt(`${order.finalAmount}`, 10);
    // }
    // const smsResult = await this.kavenegarService.notifyAdminToNewOrder(
    //   company.admin.mobile,
    //   `${order.customer.firstName || ''} ${order.customer.lastName || ''}`,
    //   order.customer.mobile,
    //   `${finalAmount}`,
    // );

    // await this.companyService.updateSmsUsedCount(
    //   company.id,
    //   smsResult?.cost || 0,
    // );
  }

  /**
   * -------------------------------------------------------
   */
  private async _generateOrderNumber() {
    const orderNumber = moment().locale('fa').format('YYYYMM'); // 140101

    const lastOrder = await this.orderRepository.findOne({
      order: { id: 'DESC' },
    });

    if (!lastOrder) {
      return `${orderNumber}1`;
    }

    const lastCounter = +lastOrder.number.substring(6);

    return `${orderNumber}${lastCounter + 1}`;
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
  async getRecordById(id: number) {
    return await this.orderRepository.findOne({ id });
  }

  /**
   * -------------------------------------------------------
   * Deleting the unpaid order (pending) after 24 hours
   */
  async handleDeleteUnpaid() {
    const pastTime = moment().subtract(24, 'hours').toDate();

    const orders = await this.orderRepository.find({
      status: OrderStatus.pending,
      createdAt: LessThan(pastTime),
    });

    try {
      for (let i = 0; i < orders.length; i++) {
        const order = orders[i];
        await this.delete(order.id);
      }
    } catch (e) {}

    return true;
  }

  /**
   * -------------------------------------------------------
   */
  private async _deleteItemsAndRollbackQuantity(orderItems: OrderItemEntity[]) {
    for (let i = 0; i < orderItems.length; i++) {
      const orderItem = orderItems[i];

      // rollback productAttributeValue stock quantity
      if (orderItem.productAttributeValue) {
        if (orderItem.productAttributeValue.quantity !== -1) {
          await this.productService.updateAttributeQuantity(
            orderItem.productAttributeValue.id,
            orderItem.productAttributeValue.quantity + orderItem.quantity,
          );
        }
      }
      // rollback product stock quantity
      else if (orderItem.product.quantity !== -1) {
        await this.productService.updateQuantity(
          orderItem.product.id,
          orderItem.product.quantity + orderItem.quantity,
        );
      }

      await orderItem.remove();
    }
  }
}
