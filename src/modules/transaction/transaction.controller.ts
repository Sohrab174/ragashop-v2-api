import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ErrorService } from '../../error/error.service';
import { TransactionService } from './transaction.service';
import { successfulResult } from '../../utils';
import { Customer } from '../../utils/decorators/customer.decorator';
import { CustomerJwtAuthGuard } from '../customer/jwt/jwt.guard';
import { Page } from '../../utils/decorators/page.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { Filter } from '../../utils/decorators/filter.decorator';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { RolesGuard } from '../auth/role/role.guard';
import { Roles } from '../auth/role/role.decorator';
import { UserRoles } from '../user/entities/user.entity';
import { TransactionStatus } from './entities/transaction.entity';
import { Response } from 'express';

@ApiTags('Transaction')
@Controller('transactions')
export class TransactionController {
  constructor(
    private transactionService: TransactionService,
    private error: ErrorService,
  ) {}

  /**
   * -------------------------------------------------------
   * GET /transactions
   */
  @Get()
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  @ApiQuery({ name: 'order_number', required: false })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAll(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter(['order_number', 'order.number'])
    filters,
    @Customer('id') customerId,
  ) {
    const list = await this.transactionService.getAll(
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
   * GET /transactions/admin
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @ApiQuery({ name: 'order_id', required: false })
  @ApiQuery({ name: 'customer_id', required: false })
  @ApiQuery({ name: 'gateway_id', required: false })
  @ApiQuery({ name: 'status', required: false, enum: TransactionStatus })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAllForAdmin(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter([
      ['order_id', 'orderId'],
      ['customer_id', 'customerId'],
      ['gateway_id', 'gatewayId'],
      ['status'],
    ])
    filters,
  ) {
    const list = await this.transactionService.getAllForAdmin(
      page,
      limit,
      filters,
      sorts,
    );

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * POST /transactions
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async create(
    @Customer() customer,
    @Body() dto: CreateTransactionDto,
    @Req() req,
  ) {
    const ip = (req?.clientIp || '').replace('::ffff:', '');

    const result = await this.transactionService.add(dto, customer, ip);
    return successfulResult(['در حال ارسال به درگاه بانکی'], result);
  }

  /**
   * -------------------------------------------------------
   * GET /transactions/zarinpal/verify
   */
  @Get('zarinpal/verify')
  async zarinpalRedirect(
    @Query('Authority') authority: string,
    @Query('Status') status: string,
    @Res() res: Response,
  ) {
    const redirectUrl = await this.transactionService.verifyZarinpal(
      authority,
      status,
    );

    // http://example.com/payment?status=success&message=انجامشد
    return res.redirect(redirectUrl);
  }

  /**
   * -------------------------------------------------------
   * GET /transactions/zibal/verify
   */
  @Get('zibal/verify')
  async verifyZibal(
    @Query('trackId') authority: string,
    @Query('status') status: string,
    @Res() res: Response,
  ) {
    const redirectUrl = await this.transactionService.verifyZibal(
      authority,
      status,
    );

    // http://example.com/payment?status=success&message=انجامشد
    return res.redirect(redirectUrl);
  }

  /**
   * -------------------------------------------------------
   * POST /transactions/payping/verify
   */
  @Post('payping/verify')
  async verifyPayping(
    @Query('code') authority: string,
    @Query('refid') referenceNumber: string,
    @Query('cardnumber') cardMask: string,
    // @Query('cardhashpan') cardHash: string,
    @Res() res: Response,
  ) {
    const redirectUrl = await this.transactionService.verifyPayping(
      authority,
      referenceNumber,
      cardMask,
    );

    // http://example.com/payment?status=success&message=انجامشد
    return res.redirect(redirectUrl);
  }

  /**
   * -------------------------------------------------------
   * TODO: change all @Query to @Body
   * POST /payments/sep/verify
   */
  @Post('/sep/verify')
  async sepVerify(
    @Query('MID') merchantId: string,
    @Query('TerminalId') terminalId: string,
    @Query('Rrn') rnn: string,
    @Query('Status') verifyStatusNumber: string,
    @Query('State') verifyStatusCode: number,
    @Query('RefNum') referenceNumber: string,
    @Query('ResNum') randomToken: string,
    @Query('Amount') amount: number,
    @Query('Token') payToken: string,
    @Query('SecurePan') maskedCardNumber: string,
    @Query('HashedCardNumber') hashedCardNumber: string,
    @Query('TraceNo') trackingCode: string,
    @Query('AffectiveAmount') reduceCardAmount: number,
    @Res() res: Response,
  ) {
    const redirectUrl = await this.transactionService.sepVerify(
      randomToken,
      referenceNumber,
      +amount / 10,
      {
        merchantId,
        terminalId,
        verifyStatusNumber: +verifyStatusNumber,
        verifyStatusCode,
        rnn,
        reduceCardAmount: +(reduceCardAmount || '0') / 10,
        payToken,
        maskedCardNumber,
        hashedCardNumber,
        trackingCode,
      },
    );
    return res.redirect(redirectUrl);
  }

  /**
   * -------------------------------------------------------
   * TODO: change all @Query to @Body
   * POST /payments/bpm/verify
   */
  @Post('/bpm/verify')
  async bpmVerify(
    @Query('ResCode') resCode: string,
    @Query('SaleOrderId') saleOrderId: string,
    @Query('SaleReferenceId') saleReferenceId: string,
    @Query('CardHolderPan') cardHolderPan: string,
    @Res() res: Response,
  ) {
    const redirectUrl = await this.transactionService.bpmVerify(
      resCode,
      saleOrderId,
      saleReferenceId,
      cardHolderPan,
    );
    return res.redirect(redirectUrl);
  }

  // /**
  //  * -------------------------------------------------------
  //  * POST /transactions/dpo-pay/verify
  //  */
  // @Get('dpo-pay/verify')
  // async verifyDpoPay(
  //   @Query('TransactionToken') authority: string,
  //   @Res() res: Response,
  // ) {
  //   const redirectUrl = await this.transactionService.verifyDpoPay(authority);

  //   // http://example.com/payment?status=success&message=Done
  //   return res.redirect(redirectUrl);
  // }
}
