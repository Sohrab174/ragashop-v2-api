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
import { ZarinpalService } from '../../gateway/zarinpal/zarinpal.service';
import { ZibalService } from '../../gateway/zibal/zibal.service';
import { PaypingService } from '../../gateway/payping/payping.service';
import {
  GatewayNames,
  GatewayStatus,
} from '../gateway/entities/gateway.entity';
import { ConfigurationService } from '../../config/configuration.service';
import * as moment from 'jalali-moment';
import { OrderService } from '../order/order.service';
import { GatewayService } from '../gateway/gateway.service';
import { DpoPayService } from '../../gateway/dpo-pay/dpo-pay.service';
import {
  SepGatewayService,
  sepGatewayTranslateNumber,
} from '../../gateway/sep-gateway/sep-gateway.service';
import {
  BpmGatewayService,
  bpmGatewayTranslateNumber,
} from '../../gateway/bpm-gateway/bpm-gateway.service';

@Injectable()
export class TransactionService {
  constructor(
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,

    private config: ConfigurationService,
    private error: ErrorService,
    private zarinpal: ZarinpalService,
    private zibal: ZibalService,
    private payping: PaypingService,
    private dpoPay: DpoPayService,
    private sepGatewayService: SepGatewayService,
    private bpmGatewayService: BpmGatewayService,
    private orderService: OrderService,
    private gatewayService: GatewayService,
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
    const order = await this.orderService.getRecordById(dto.orderId);
    if (!order) {
      this.error.unprocessableEntity(['سفارش موردنظر پیدا نشد']);
    }

    const gateway = await this.gatewayService.getById(dto.gatewayId);

    // if (order.status === OrderStatus.pending) {
    //   this.error.unprocessableEntity([
    //     ('t.This order has not yet been confirmed!'),
    //   ]);
    // }

    if (
      order.status === OrderStatus.paid ||
      order.status === OrderStatus.sent ||
      order.status === OrderStatus.delivered
    ) {
      this.error.unprocessableEntity(['این سفارش پرداخت شده است']);
    }

    // insert into transaction
    const { identifiers } = await this.transactionRepository
      .createQueryBuilder()
      .insert()
      .values({
        orderId: dto.orderId,
        customerId: customer.id,
        gatewayId: dto.gatewayId,
        amount: order.finalAmount,
        reduceCardAmount: 0,
        terminalId: gateway.merchantId || null,
        merchantId: gateway.merchantId || null,
        status: TransactionStatus.pending,
        ip,
        createdAt: new Date(),
      })
      .execute();

    const newTransactionId = identifiers[0].id;
    const transaction = await this.getTransactionById(newTransactionId);

    const connection = await this.connectToGateway(transaction);

    return { transactionId: transaction.id, bankUrl: connection.bankUrl };
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
      this.error.unprocessableEntity(['t.The request is not valid!']);
    }

    return transaction;
  }

  private async getTransactionByAuthority(randomToken) {
    const transaction = await this.getTransactionBuilder()
      .andWhere({ randomToken })
      .leftJoinAndSelect('transaction.order', 'order')
      .leftJoinAndSelect('order.orderItems', 'orderItems')
      .leftJoinAndSelect('orderItems.product', 'product')
      .leftJoinAndSelect('product.service', 'service')
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

      // SEP (Saman)
      if (transaction.gateway.name === GatewayNames.sep) {
        callbackUrl = `${this.generateSiteBaseUrl()}/sep.php`;

        result.authority = await this._generateCode();

        const sepResult = await this.sepGatewayService.paymentRequest(
          transaction.gateway.merchantId,
          transaction.amount,
          transaction?.customer?.mobile || '',
          result.authority,
          callbackUrl,
        );

        result.payToken = sepResult.payToken;
        result.url = `${this.generateSiteBaseUrl()}/bpm.php?token=${
          sepResult.payToken
        }`;
      }

      // BPM (mellat)
      else if (transaction.gateway.name === GatewayNames.bpm) {
        callbackUrl = `${this.generateSiteBaseUrl()}/bpm.php`;

        result.authority = await this._generateCode();

        const bpmResult: any = await this.bpmGatewayService.paymentRequest(
          {
            terminalId: transaction.gateway.merchantId,
            username: transaction.gateway.username,
            password: transaction.gateway.password,
          },
          transaction.amount,
          transaction?.customer?.mobile || '',
          +result.authority,
          callbackUrl,
        );

        result.payToken = bpmResult.payToken;
        result.url = `${this.generateSiteBaseUrl()}/bpm.php?token=${
          bpmResult.payToken
        }&mobile=${bpmResult.payMobile}`;
      }

      // Zarinpal
      else if (transaction.gateway.name === GatewayNames.zarinpal) {
        callbackUrl = `${this.generateSiteBaseUrl()}/zarinpal.php`;

        const zarinpalResult = await this.zarinpal.paymentRequest(
          transaction.gateway.merchantId,
          transaction.amount,
          transaction?.customer?.mobile || '',
          callbackUrl,
          'Ragashop',
        );

        result.authority = zarinpalResult.payToken;
        result.url = `${this.generateSiteBaseUrl()}/zarinpal.php?token=${
          zarinpalResult.payToken
        }`;
      }

      // Zibal
      else if (transaction.gateway.name === GatewayNames.zibal) {
        result = await this.zibal.paymentRequest(
          transaction.gateway.merchantId,
          transaction.amount,
          callbackUrl,
          'Ragashop',
        );
      }

      // Payping
      else if (transaction.gateway.name === GatewayNames.payping) {
        callbackUrl = `${this.generateSiteBaseUrl()}/api/payping`;

        result = await this.payping.paymentRequest(
          transaction.gateway.merchantId,
          transaction.amount,
          transaction.id,
          callbackUrl,
        );
      }

      // DPO pay
      // else if (transaction.gateway.name === GatewayNames.dpoPay) {
      //   result = await this.dpoPay.paymentRequest(
      //     transaction.gateway.merchantId, // company token
      //     transaction.gateway.username, // service type
      //     transaction.amount,
      //     transaction.company.defaultCurrency,
      //     callbackUrl,
      //     {
      //       email: transaction?.customer?.email || '',
      //       firstName: transaction?.customer?.firstName || '',
      //       lastName: transaction?.customer?.lastName || '',
      //     },
      //   );
      // }

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

    this.error.unprocessableEntity(['t.The request is not valid!']);
  }

  /**
   * --------------------------------------------------------
   */
  async verifyZarinpal(authority: string, status: string) {
    const transaction = await this.getTransactionByAuthority(authority);
    if (!transaction) {
      return `${this.config.app.siteBaseUrl}/payment?status=error&gateway=zarinpal&code=404`;
    }

    const siteBaseUrl = this.generateSiteBaseUrl();

    if (status === 'NOK') {
      return `${siteBaseUrl}/payment?status=error&gateway=zarinpal&code=502&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    let referenceNumber = '';
    try {
      const result = await this.zarinpal.paymentVerification(
        transaction.gateway.merchantId,
        authority,
        transaction.amount,
      );
      referenceNumber = result?.referenceNumber || '';

      await this.update(transaction.id, {
        referenceNumber,
        message: `پرداخت موفق با کد: ${result?.code || ''}`,
        status: TransactionStatus.paid,
      });
    } catch (error) {
      await this.update(transaction.id, {
        message: error,
      });

      return `${siteBaseUrl}/payment?status=error&gateway=zarinpal&code=501&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    // Completing the order that related to this transaction
    await this.orderService.complete(transaction.orderId);

    return `${siteBaseUrl}/payment?status=success&gateway=zarinpal&code=200&order_id=${
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
  async verifyZibal(authority: string, status: string) {
    const transaction = await this.getTransactionByAuthority(authority);
    if (!transaction) {
      return `${this.config.app.siteBaseUrl}/payment?status=error&gateway=zibal&code=404`;
    }

    const siteBaseUrl = this.generateSiteBaseUrl();

    if (status !== '2') {
      return `${siteBaseUrl}/payment?status=error&gateway=zibal&code=502&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    let referenceNumber = '';
    try {
      const result = await this.zibal.paymentVerification(
        transaction.gateway.merchantId,
        authority,
      );
      referenceNumber = result?.referenceNumber || '';

      await this.update(transaction.id, {
        referenceNumber,
        message: result?.message || '',
        status: TransactionStatus.paid,
      });
    } catch (error) {
      await this.update(transaction.id, {
        message: error,
      });

      return `${siteBaseUrl}/payment?status=error&gateway=zibal&code=501&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    // Completing the order that related to this transaction
    await this.orderService.complete(transaction.orderId);

    return `${siteBaseUrl}/payment?status=success&gateway=zibal&code=200&order_id=${
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

    return `${siteBaseUrl}/payment?status=success&gateway=payping&code=200&order_id=${
      transaction.orderId
    }&order_number=${transaction.order.number}&transaction_id=${
      transaction.id
    }&number=${referenceNumber}&amount=${transaction.amount}&date=${moment(
      transaction.createdAt,
    ).format('YYYY-MM-DD')}&message=پرداخت با موفقیت انجام شد`;
  }

  /**
   * -------------------------------------------------------
   */
  async sepVerify(
    authority: string,
    referenceNumber: string,
    amount: number,
    extraParams,
  ) {
    if (!authority) {
      return `${this.config.app.siteBaseUrl}/payment?status=error&gateway=sep&code=404`;
    }

    const transaction = await this.getTransactionByAuthority(authority);
    if (!transaction) {
      return `${this.config.app.siteBaseUrl}/payment?status=error&gateway=sep&code=404`;
    }

    const siteBaseUrl = this.generateSiteBaseUrl();
    const message =
      sepGatewayTranslateNumber?.[extraParams.verifyStatusNumber] || null;

    await this.update(transaction.id, {
      ...extraParams,
      referenceNumber,
      message,
    });

    if (!referenceNumber) {
      return `${siteBaseUrl}/payment?status=error&gateway=sep&code=500&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    if (extraParams.verifyStatusNumber !== 2) {
      return `${siteBaseUrl}/payment?status=error&gateway=sep&code=500&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    if (
      transaction.terminalId !== extraParams?.terminalId ||
      transaction.amount !== amount
    ) {
      return `${siteBaseUrl}/payment?status=error&gateway=sep&code=500&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    try {
      const details = await this.sepGatewayService.paymentVerification(
        transaction.terminalId,
        referenceNumber,
      );

      await this.update(transaction.id, {
        status: TransactionStatus.paid,
        paidAt: details?.StraceDate || new Date(),
      });
    } catch (error) {
      await this.update(transaction.id, {
        message: error,
        referenceNumber,
        status: TransactionStatus.failed,
      });

      return `${siteBaseUrl}/payment?status=error&gateway=sep&code=501&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    // Completing the order that related to this transaction
    await this.orderService.complete(transaction.orderId);

    return `${siteBaseUrl}/payment?status=success&gateway=sep&code=200&order_id=${
      transaction.orderId
    }&order_number=${transaction.order.number}&transaction_id=${
      transaction.id
    }&number=${referenceNumber}&amount=${transaction.amount}&date=${moment(
      transaction.createdAt,
    ).format('YYYY-MM-DD')}&message=پرداخت با موفقیت انجام شد`;
  }

  /**
   * -------------------------------------------------------
   */
  async bpmVerify(
    resCode: string,
    authority: string,
    referenceNumber: string,
    cardHolderPan: string,
  ) {
    if (resCode === undefined || resCode === '' || !authority) {
      return `${this.config.app.siteBaseUrl}/payment?status=error&gateway=bpm&code=404`;
    }

    const transaction = await this.getTransactionByAuthority(authority);
    if (!transaction) {
      return `${this.config.app.siteBaseUrl}/payment?status=error&gateway=bpm&code=404`;
    }

    const siteBaseUrl = this.generateSiteBaseUrl();
    const message = bpmGatewayTranslateNumber?.[+resCode] || null;

    if (+resCode !== 0) {
      await this.update(transaction.id, {
        referenceNumber,
        message,
        status: TransactionStatus.failed,
      });
      return `${siteBaseUrl}/payment?status=error&gateway=bpm&code=500&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    await this.update(transaction.id, {
      maskedCardNumber: cardHolderPan || null,
      referenceNumber,
      message,
    });

    if (!referenceNumber) {
      return `${siteBaseUrl}/payment?status=error&gateway=bpm&code=500&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    try {
      await this.bpmGatewayService.paymentVerification(
        {
          terminalId: transaction.gateway.merchantId,
          username: transaction.gateway.username,
          password: transaction.gateway.password,
        },
        +authority,
        referenceNumber,
      );

      await this.update(transaction.id, {
        status: TransactionStatus.paid,
        paidAt: new Date(),
      });
    } catch (error) {
      await this.update(transaction.id, {
        message: error,
        referenceNumber,
        status: TransactionStatus.failed,
      });

      return `${siteBaseUrl}/payment?status=error&gateway=bpm&code=501&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
    }

    // Completing the order that related to this transaction
    await this.orderService.complete(transaction.orderId);

    return `${siteBaseUrl}/payment?status=success&gateway=bpm&code=200&order_id=${
      transaction.orderId
    }&order_number=${transaction.order.number}&transaction_id=${
      transaction.id
    }&number=${referenceNumber}&amount=${transaction.amount}&date=${moment(
      transaction.createdAt,
    ).format('YYYY-MM-DD')}&message=پرداخت با موفقیت انجام شد`;
  }

  // /**
  //  * --------------------------------------------------------
  //  */
  // async verifyDpoPay(authority: string) {
  //   const transaction = await this.getTransactionByAuthority(authority);
  //   if (!transaction) {
  //     return `${this.config.app.siteBaseUrl}/payment?status=error&gateway=dpo-pay&code=404`;
  //   }

  //   const siteBaseUrl = this.generateSiteBaseUrl();

  //   try {
  //     const { message, referenceNumber } =
  //       await this.dpoPay.paymentVerification(
  //         transaction.gateway.merchantId,
  //         authority,
  //       );

  //     await this.update(transaction.id, {
  //       referenceNumber,
  //       message,
  //       status: TransactionStatus.paid,
  //     });

  //     // Completing the order that related to this transaction
  //     await this.orderService.complete(transaction.orderId);

  //     return `${siteBaseUrl}/payment?status=success&gateway=dpo-pay&code=200&order_id=${
  //       transaction.orderId
  //     }&order_number=${transaction.order.number}&transaction_id=${
  //       transaction.id
  //     }&number=${referenceNumber}&amount=${transaction.amount}&date=${moment(
  //       transaction.createdAt,
  //     ).format('YYYY-MM-DD')}`;
  //   } catch (error) {
  //     return `${siteBaseUrl}/payment?status=error&gateway=dpo-pay&code=501&transaction_id=${transaction.id}&order_id=${transaction.orderId}&order_number=${transaction.order.number}`;
  //   }
  // }

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
