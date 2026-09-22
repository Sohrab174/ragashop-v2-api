import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { successfulResult } from '../../utils';
import { buildSafeContentDisposition } from '../../utils/content-disposition';
import { Customer } from '../../utils/decorators/customer.decorator';
import { User } from '../../utils/decorators/user.decorator';
import { CustomerJwtAuthGuard } from '../customer/jwt/jwt.guard';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { RolesGuard } from '../auth/role/role.guard';
import { Roles } from '../auth/role/role.decorator';
import { PermissionsGuard } from '../auth/capability/permissions.guard';
import { RequireCapabilities } from '../auth/capability/capability.decorator';
import { UserRoles } from '../user/entities/user.entity';
import { Page } from '../../utils/decorators/page.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { Filter } from '../../utils/decorators/filter.decorator';
import { ErrorService } from '../../error/error.service';
import { ManualPaymentMethodService } from './manual-payment-method.service';
import { BankDestinationService } from './bank-destination.service';
import { PaymentSubmissionService } from './payment-submission.service';
import {
  ManualPaymentRail,
  PaymentSubmissionStatus,
  RECEIPT_MAX_BYTES,
  UserCapabilityName,
} from './manual-payment.types';
import {
  ApprovePaymentSubmissionDto,
  CreateBankDestinationDto,
  CreatePaymentSubmissionBodyDto,
  RejectPaymentSubmissionDto,
  ResubmitPaymentBodyDto,
  UpdateBankDestinationDto,
  UpdateManualPaymentMethodDto,
} from './dto/manual-payment.dto';

const receiptUpload = FileInterceptor('receipt', {
  storage: memoryStorage(),
  limits: { fileSize: RECEIPT_MAX_BYTES },
});

@ApiTags('ManualPayment')
@Controller()
export class ManualPaymentController {
  constructor(
    private readonly methodService: ManualPaymentMethodService,
    private readonly bankDestinationService: BankDestinationService,
    private readonly submissionService: PaymentSubmissionService,
    private readonly error: ErrorService,
  ) {}

  // ---------- Customer ----------

  @Get('manual-payments/methods')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async listMethods() {
    const items = await this.methodService.listEnabledForCustomer();
    return successfulResult([], items);
  }

  @Get('manual-payments/destinations')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  @ApiQuery({ name: 'rail', required: false, enum: ManualPaymentRail })
  @ApiQuery({ name: 'amount', required: false })
  async listDestinations(
    @Query('rail') rail?: ManualPaymentRail,
    @Query('amount') amount?: string,
  ) {
    const amountIrt =
      amount != null && amount !== '' ? Number(amount) : undefined;
    const items = await this.bankDestinationService.listForCustomer({
      rail,
      amountIrt: Number.isFinite(amountIrt) ? amountIrt : undefined,
    });
    return successfulResult([], items);
  }

  @Get('orders/:orderId/manual-payment/instructions')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async instructions(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Customer('id') customerId: number,
  ) {
    const data = await this.submissionService.getTransferInstructions(
      orderId,
      customerId,
    );
    return successfulResult([], data);
  }

  @Post('orders/:orderId/manual-payment/submissions')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(receiptUpload)
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        receipt: { type: 'string', format: 'binary' },
        rail: { type: 'string' },
        bankDestinationId: { type: 'number' },
        idempotencyKey: { type: 'string' },
        submittedAmount: { type: 'number' },
        bankReference: { type: 'string' },
        payerName: { type: 'string' },
        customerNote: { type: 'string' },
      },
      required: ['receipt', 'rail', 'bankDestinationId', 'idempotencyKey'],
    },
  })
  async createSubmission(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Customer('id') customerId: number,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreatePaymentSubmissionBodyDto,
  ) {
    if (!file?.buffer) {
      this.error.unprocessableEntity(['فایل رسید الزامی است']);
    }
    const data = await this.submissionService.createSubmissionWithEvidence({
      orderId,
      customerId,
      rail: body.rail,
      bankDestinationId: Number(body.bankDestinationId),
      file,
      submittedAmount:
        body.submittedAmount != null ? Number(body.submittedAmount) : null,
      bankReference: body.bankReference,
      payerName: body.payerName,
      customerNote: body.customerNote,
      idempotencyKey: body.idempotencyKey,
    });
    return successfulResult(['رسید با موفقیت ارسال شد'], data);
  }

  @Get('orders/:orderId/manual-payment/submission')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async getSubmissionForOrder(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Customer('id') customerId: number,
  ) {
    const data = await this.submissionService.getStatusForCustomer(
      orderId,
      customerId,
    );
    return successfulResult([], data);
  }

  @Post('manual-payments/submissions/:id/resubmit')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(receiptUpload)
  async resubmit(
    @Param('id', ParseIntPipe) id: number,
    @Customer('id') customerId: number,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: ResubmitPaymentBodyDto,
  ) {
    if (!file?.buffer) {
      this.error.unprocessableEntity(['فایل رسید الزامی است']);
    }
    const data = await this.submissionService.resubmit({
      submissionId: id,
      customerId,
      file,
      submittedAmount:
        body.submittedAmount != null ? Number(body.submittedAmount) : null,
      bankReference: body.bankReference,
      payerName: body.payerName,
      customerNote: body.customerNote,
    });
    return successfulResult(['رسید مجدداً ارسال شد'], data);
  }

  @Get('manual-payments/receipts/:objectId')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async streamOwnReceipt(
    @Param('objectId') objectId: string,
    @Customer('id') customerId: number,
    @Res() res: Response,
  ) {
    const { object, stream } =
      await this.submissionService.streamReceiptForCustomer(
        objectId,
        customerId,
      );
    res.setHeader('Content-Type', object.mimeType);
    res.setHeader(
      'Content-Disposition',
      buildSafeContentDisposition(object.originalFilename),
    );
    stream.pipe(res);
  }

  // ---------- Admin: methods ----------

  @Get('manual-payments/methods/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async listMethodsAdmin() {
    const items = await this.methodService.listAllAdmin();
    return successfulResult([], items);
  }

  @Put('manual-payments/methods/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.bank_destination_manage)
  async updateMethod(@Body() dto: UpdateManualPaymentMethodDto) {
    const { id, rail, ...patch } = dto;
    const data = await this.methodService.updateMethod({ id, rail }, patch);
    return successfulResult(['روش پرداخت به‌روزرسانی شد'], data);
  }

  // ---------- Admin: bank destinations ----------

  @Get('manual-payments/destinations/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async listBankDestinationsAdmin() {
    const items = await this.bankDestinationService.listAllAdmin();
    return successfulResult([], items);
  }

  @Get('manual-payments/destinations/:id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async getBankDestinationAdmin(@Param('id', ParseIntPipe) id: number) {
    const data = await this.bankDestinationService.getById(id);
    return successfulResult([], data);
  }

  @Post('manual-payments/destinations/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.bank_destination_manage)
  async createBankDestination(
    @Body() dto: CreateBankDestinationDto,
    @User('id') userId: number,
  ) {
    const data = await this.bankDestinationService.create(dto, userId);
    return successfulResult(['مقصد بانکی ایجاد شد'], data);
  }

  @Put('manual-payments/destinations/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.bank_destination_manage)
  async updateBankDestination(
    @Body() dto: UpdateBankDestinationDto,
    @User('id') userId: number,
  ) {
    const { id, ...patch } = dto;
    await this.bankDestinationService.update(id, patch, userId);
    return successfulResult(['مقصد بانکی به‌روزرسانی شد']);
  }

  @Delete('manual-payments/destinations/:id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.bank_destination_manage)
  async disableBankDestination(
    @Param('id', ParseIntPipe) id: number,
    @User('id') userId: number,
  ) {
    await this.bankDestinationService.softDisable(id, userId);
    return successfulResult(['مقصد بانکی غیرفعال شد']);
  }

  // ---------- Admin: submissions ----------

  @Get('manual-payments/submissions/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.payment_submission_read)
  @ApiQuery({ name: 'status', required: false, enum: PaymentSubmissionStatus })
  @ApiQuery({ name: 'order_id', required: false })
  @ApiQuery({ name: 'customer_id', required: false })
  @ApiQuery({ name: 'sort', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'page', required: false })
  async listSubmissionsAdmin(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter(['status', 'orderId', 'order_id', 'customerId', 'customer_id'])
    filters,
  ) {
    const list = await this.submissionService.listAdmin(
      page,
      limit,
      filters,
      sorts,
    );
    return successfulResult([], list);
  }

  @Get('manual-payments/submissions/:id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.payment_submission_read)
  async getSubmissionAdmin(@Param('id', ParseIntPipe) id: number) {
    const data = await this.submissionService.getAdminDetail(id);
    return successfulResult([], data);
  }

  @Post('manual-payments/submissions/:id/claim/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.payment_submission_review)
  async claim(
    @Param('id', ParseIntPipe) id: number,
    @User() user,
  ) {
    const data = await this.submissionService.claim(id, user);
    return successfulResult(['ارسال در حال بررسی قرار گرفت'], data);
  }

  @Post('manual-payments/submissions/:id/approve/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.payment_submission_approve)
  async approve(
    @Param('id', ParseIntPipe) id: number,
    @User() user,
    @Body() dto: ApprovePaymentSubmissionDto,
  ) {
    const data = await this.submissionService.approveAtomic(id, user, {
      amountMismatchOverrideReason: dto.amountMismatchOverrideReason,
    });
    return successfulResult(['پرداخت دستی تایید شد'], data);
  }

  @Post('manual-payments/submissions/:id/reject/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.payment_submission_review)
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @User() user,
    @Body() dto: RejectPaymentSubmissionDto,
  ) {
    const data = await this.submissionService.reject(id, user, dto);
    return successfulResult(['ارسال رد شد'], data);
  }

  @Get('manual-payments/submissions/:id/receipt/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.payment_submission_read)
  async streamAdminReceipt(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const { object, stream } =
      await this.submissionService.streamReceiptForAdmin(id);
    res.setHeader('Content-Type', object.mimeType);
    res.setHeader(
      'Content-Disposition',
      buildSafeContentDisposition(object.originalFilename),
    );
    stream.pipe(res);
  }
}
