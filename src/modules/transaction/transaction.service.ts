import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TransactionEntity,
  TransactionStatus,
} from './entities/transaction.entity';
import { ErrorService } from '../../error/error.service';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  generateRandomDigitCode,
  paginationResult,
  sleep,
} from '../../utils';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { CustomerEntity } from '../customer/entities/customer.entity';
import { OrderStatus } from '../order/entities/order.entity';
import { PaypingService } from '../../gateway/payping/payping.service';
import {
  GatewayNames,
  GatewayStatus,
} from '../gateway/entities/gateway.entity';
import { ConfigurationService } from '../../config/configuration.service';
import * as moment from 'jalali-moment';
import { OrderService } from '../order/order.service';
import { GatewayService } from '../gateway/gateway.service';
import { SettingService } from '../setting/setting.service';
import { CustomerService } from '../customer/customer.service';
import { WalletHistoryType } from '../customer/entities/wallet-history.entity';

@Injectable()
export class TransactionService {
  constructor(
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,

    private config: ConfigurationService,
    private error: ErrorService,
    private payping: PaypingService,
    private orderService: OrderService,
    private gatewayService: GatewayService,
    private settingService: SettingService,
    private customerService: CustomerService,
  ) {}

  /**
   * -------------------------------------------------------
   * GET /transactions
   */
  async getAll(page = 1, limit = 20, filters = null, sorts = null, customerId) {
    let builder = this.transactionRepository
      .createQueryBuilder('transaction')

      .leftJoin('transaction.order', 'order')
      .select([
        'transaction.id',
        'transaction.amount',
        'transaction.referenceNumber',
        'transaction.message',
        'transaction.status',
        'transaction.createdAt',

        'order.id',
        'order.number',
      ]);

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('transaction.createdAt', 'ASC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    builder.andWhere({ customerId });

    const [items, totalItems] = await builder
      .take(limit)
      .skip((page - 1) * limit)
      .getManyAndCount();

    return {
      items,
      pagination: paginationResult(page, limit, totalItems),
    };
  }

  /**
   * -------------------------------------------------------
   * GET /transactions/admin
   */
  async getAllForAdmin(page = 1, limit = 20, filters = null, sorts = null) {
    let builder = this.transactionRepository
      .createQueryBuilder('transaction')
      .leftJoin('transaction.gateway', 'gateway')
      .addSelect('gateway.id')
      .addSelect('gateway.name');

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('transaction.id', 'ASC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    const [items, totalItems] = await builder
      .take(limit)
      .skip((page - 1) * limit)
      .getManyAndCount();

    return {
      items,
      pagination: paginationResult(page, limit, totalItems),
    };
  }

  /**
   * -------------------------------------------------------
   * POST /transactions
   */
  async add(dto: CreateTransactionDto, customer: CustomerEntity, ip: string) {
    const order = await this.orderService.getRecordById(dto.orderId, [
      'customer',
    ]);
    if (!order) {
      this.error.unprocessableEntity(['سفارش موردنظر پیدا نشد']);
    }

    const gateway = await this.gatewayService.getById(dto.gatewayId);

    if (
      order.status === OrderStatus.paid ||
      order.status === OrderStatus.sent ||
      order.status === OrderStatus.delivered
    ) {
      this.error.unprocessableEntity(['این سفارش پرداخت شده است']);
    }

    let walletAmount = 0;
    let walletTRY = 0;
    let walletIRT = 0;
    let payAmount = order.finalAmount;
    let status = TransactionStatus.pending;

    // used wallet
    if (dto.usedWalletTRY && order.customer.walletTRY > 0) {
      const tryToToman = await this.settingService.getTryToToman();
      const wallet = order.customer.walletTRY * tryToToman;

      if (wallet >= payAmount) {
        walletTRY = payAmount / tryToToman;
        walletAmount += payAmount;
        payAmount = 0;
      } else {
        walletTRY = order.customer.walletTRY;
        walletAmount += wallet;
        payAmount -= wallet;
      }
    }

    if (payAmount > 0 && dto.usedWalletIRT && order.customer.walletIRT > 0) {
      if (order.customer.walletIRT >= payAmount) {
        walletIRT = payAmount;
        walletAmount += payAmount;
        payAmount = 0;
      } else {
        walletIRT = order.customer.walletIRT;
        walletAmount += walletIRT;
        payAmount -= walletIRT;
      }
    }

    // update customer wallet
    if (payAmount === 0) {
      order.customer.walletTRY -= walletTRY;
      order.customer.walletIRT -= walletIRT;
      await order.customer.save();

      if (walletTRY > 0) {
        await this.customerService.addWalletHistory({
          customerId: order.customerId,
          walletTRY: -1 * walletTRY,
          type: WalletHistoryType.buy,
          relatedOrderId: order.id,
        });
      }
      if (walletIRT > 0) {
        await this.customerService.addWalletHistory({
          customerId: order.customerId,
          walletIRT: -1 * walletIRT,
          type: WalletHistoryType.buy,
          relatedOrderId: order.id,
        });
      }

      status = TransactionStatus.paid;
    }

    // insert into transaction
    const { identifiers } = await this.transactionRepository
      .createQueryBuilder()
      .insert()
      .values({
        orderId: dto.orderId,
        customerId: customer.id,
        gatewayId: dto.gatewayId,
        amount: payAmount,
        walletAmount,
        walletIRT,
        walletTRY,
        walletUSD: 0,
        reduceCardAmount: 0,
        terminalId: gateway.merchantId || null,
        merchantId: gateway.merchantId || null,
        status,
        ip,
        createdAt: new Date(),
      })
      .execute();

    const newTransactionId = identifiers[0].id;

    // complete order if paid
    if (status === TransactionStatus.paid) {
      await this.orderService.complete(order.id);
      return { transactionId: newTransactionId, bankUrl: null, paid: true };
    }

    // connet to bank
    const transaction = await this.getTransactionById(newTransactionId);
    const connection = await this.connectToGateway(transaction);

    return {
      transactionId: newTransactionId,
      bankUrl: connection.bankUrl,
      paid: false,
    };
  }

  /**
   * -------------------------------------------------------
   */
  private getTransactionBuilder() {
    const builder = this.transactionRepository
      .createQueryBuilder('transaction')
      .innerJoinAndSelect(
        'transaction.gateway',
        'gateway',
        'gateway.isDeleted = 0 AND gateway.status = :status',
        { status: GatewayStatus.active },
      )
      .andWhere({ status: TransactionStatus.pending });

    return builder;
  }

  private async getTransactionById(id) {
    const transaction = await this.getTransactionBuilder()
      .leftJoinAndSelect('transaction.customer', 'customer')
      .andWhere({ id })
      .getOne();

    if (!transaction) {
      this.error.unprocessableEntity(['این درخواست نامعتبر است']);
    }

    return transaction;
  }

  private async getTransactionByAuthority(randomToken) {
    const transaction = await this.getTransactionBuilder()
      .andWhere({ randomToken })
      .leftJoinAndSelect('transaction.order', 'order')
      .leftJoinAndSelect('transaction.customer', 'customer')
      .leftJoinAndSelect('order.orderItems', 'orderItems')
      .leftJoinAndSelect('orderItems.product', 'product')
      .getOne();

    return transaction;
  }

  /**
   * --------------------------------------------------------
   */
  private async connectToGateway(transaction: TransactionEntity, retry = 0) {
    try {
      // Making a bank callback URL
      let callbackUrl = `${this.config.app.apiBaseUrl}/transactions/${transaction.gateway.name}/verify`;

      let result: any = {};

      if (transaction.gateway.name === GatewayNames.payping) {
        callbackUrl = `${this.generateSiteBaseUrl()}/api/payping`;

        result = await this.payping.paymentRequest(
          transaction.gateway.merchantId,
          transaction.amount,
          transaction.id,
          callbackUrl,
        );
      }

      if (result) {
        // Setting authority to randomToken transaction
        await this.update(transaction.id, {
          randomToken: result.authority,
          payToken: result?.payToken || null,
        });

        return {
          bankUrl: result.url,
        };
      }

      this.error.internalServerError([
        'اتصال به درگاه بانک برقرار نشد، لطفا مجدد تلاش کنید',
      ]);
    } catch (e) {
      console.log(e);

      if (retry < 3) {
        await sleep(1000);
        return await this.connectToGateway(transaction, retry + 1);
      }

      this.error.internalServerError([
        e || 'اتصال به درگاه بانک برقرار نشد، لطفا مجدد تلاش کنید',
      ]);
    }

    this.error.unprocessableEntity(['این درخواست نامعتبر است']);
  }

  /**
   * --------------------------------------------------------
   */
  async verifyPayping(
    authority: string,
    referenceNumber: string,
    cardMask: string,
  ) {
    const transaction = await this.getTransactionByAuthority(authority);
    if (!transaction) {
      return `${this.config.app.siteBaseUrl}/payment?status=error&gateway=payping&code=404`;
    }

    const siteBaseUrl = this.generateSiteBaseUrl();

    if (+referenceNumber < 100) {
      return `${siteBaseUrl}/payment?status=error&gateway=payping&code=500&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    if (
      transaction.walletTRY &&
      transaction.walletTRY > transaction.customer.walletTRY
    ) {
      return `${siteBaseUrl}/payment?status=error&gateway=payping&code=500&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    if (
      transaction.walletIRT &&
      transaction.walletIRT > transaction.customer.walletIRT
    ) {
      return `${siteBaseUrl}/payment?status=error&gateway=payping&code=500&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    try {
      const message = await this.payping.paymentVerification(
        transaction.gateway.merchantId,
        referenceNumber,
        transaction.amount,
      );

      await this.update(transaction.id, {
        referenceNumber,
        maskedCardNumber: cardMask,
        message,
        paidAt: new Date(),
        status: TransactionStatus.paid,
      });
    } catch (error) {
      await this.update(transaction.id, {
        referenceNumber,
        message: error,
        maskedCardNumber: cardMask,
        status: TransactionStatus.failed,
      });

      return `${siteBaseUrl}/payment?status=error&gateway=payping&code=501&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    // Completing the order that related to this transaction
    await this.orderService.complete(transaction.orderId);

    // update customer wallet
    if (transaction.walletTRY > 0 || transaction.walletIRT > 0) {
      await this.customerService.updateWallet({
        customerId: transaction.customerId,
        changeWalletTRY: -1 * transaction.walletTRY,
        changeWalletIRT: -1 * transaction.walletIRT,
      });
    }

    // add customer wallet history
    if (transaction.walletTRY > 0) {
      await this.customerService.addWalletHistory({
        customerId: transaction.customerId,
        walletTRY: -1 * transaction.walletTRY,
        type: WalletHistoryType.buy,
        relatedOrderId: transaction.orderId,
      });
    }
    if (transaction.walletIRT > 0) {
      await this.customerService.addWalletHistory({
        customerId: transaction.customerId,
        walletIRT: -1 * transaction.walletIRT,
        type: WalletHistoryType.buy,
        relatedOrderId: transaction.orderId,
      });
    }

    return `${siteBaseUrl}/payment?status=success&gateway=payping&code=200&order_id=${
      transaction.orderId
    }&order_number=${transaction.order.number}&transaction_id=${
      transaction.id
    }&number=${referenceNumber}&amount=${transaction.amount}&date=${moment(
      transaction.createdAt,
    ).format('YYYY-MM-DD')}&message=پرداخت با موفقیت انجام شد`;
  }

  /**
   * --------------------------------------------------------
   */
  private generateSiteBaseUrl() {
    // let siteBaseUrl = `${company.code}.${this.config.app.baseDomain}`;
    // if (company.domain) {
    //   siteBaseUrl = company.domain;
    // }

    // return `https://${siteBaseUrl}`;
    return 'https://ragashop.co';
  }

  /**
   * --------------------------------------------------------
   */
  private async update(id: number, data) {
    await this.transactionRepository
      .createQueryBuilder()
      .update()
      .set(data)
      .where({ id })
      .execute();
  }

  /**
   * --------------------------------------------------------
   */
  private async _generateCode(length = 14) {
    while (true) {
      const newToken = generateRandomDigitCode(length);
      if (newToken.charAt(0) === '0') continue;

      const count = await this.transactionRepository.count({
        randomToken: newToken,
      });
      if (count === 0) {
        return newToken;
      }
    }
  }
}
