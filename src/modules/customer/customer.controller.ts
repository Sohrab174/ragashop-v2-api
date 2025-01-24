import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { successfulResult } from '../../utils';
import { Filter } from '../../utils/decorators/filter.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Page } from '../../utils/decorators/page.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { User } from '../../utils/decorators/user.decorator';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { CustomerJwtAuthGuard } from './jwt/jwt.guard';
import { Roles } from '../auth/role/role.decorator';
import { RolesGuard } from '../auth/role/role.guard';
import { UserRoles } from '../user/entities/user.entity';
import { CustomerService } from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerStatus } from './entities/customer.entity';
import { Customer } from '../../utils/decorators/customer.decorator';
import { CustomerLoginDto } from './dto/customer-login.dto';
import { CustomerSignupDto } from './dto/customer-signup.dto';
import { ConfigurationService } from '../../config/configuration.service';
import { CustomerUpdateMeDto } from './dto/customer-update-me.dto';
import { CustomerChangePasswordDto } from './dto/customer-change-password.dto';
import { CustomerForgotDto } from './dto/customer-forgot.dto';
import { CustomerVerifySignupDto } from './dto/customer-verify-signup.dto';
import { CustomerResetPasswordDto } from './dto/customer-reset-password.dto';
import { CustomerResendOtpDto } from './dto/customer-resend-otp.dto';
import { CustomerLoginMobileDto } from './dto/customer-login-mobile.dto';
import { CustomerLoginVerifyDto } from './dto/customer-login-verify.dto';

@ApiTags('Customer')
@Controller('customers')
export class CustomerController {
  constructor(
    private customerService: CustomerService,
    private config: ConfigurationService,
  ) {}

  /**
   * --------------------------------------------------------
   */
  @Post('login/mobile')
  async loginByMobile(@Body() dto: CustomerLoginMobileDto) {
    const data = await this.customerService.loginByMobile(dto);
    return successfulResult(['t.The verification code has been sent'], data);
  }

  /**
   * --------------------------------------------------------
   */
  @Post('login/verify')
  async verifyLogin(@Body() dto: CustomerLoginVerifyDto) {
    const response = await this.customerService.verifyLogin(dto);
    if (response) {
      return successfulResult(['t.You have successfully logged in'], response);
    }
  }

  /**
   * --------------------------------------------------------
   */
  @Post('login')
  async login(@Body() dto: CustomerLoginDto) {
    const response = await this.customerService.login(dto);
    return successfulResult(['t.You have successfully logged in'], response);
  }

  /**
   * --------------------------------------------------------
   */
  @Get('me')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async me(@Customer('id') customerId: number) {
    const info = await this.customerService.getActiveById(customerId);
    return successfulResult([], info);
  }

  /**
   * --------------------------------------------------------
   */
  @Put('me')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async updateMe(
    @Customer('id') customerId: number,
    @Body() dto: CustomerUpdateMeDto,
  ) {
    await this.customerService.updateMe(customerId, dto);
    return successfulResult(['t.Your profile has been successfully updated']);
  }

  /**
   * --------------------------------------------------------
   * PUT /customers/me/password
   */
  @Put('me/password')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async changePassword(
    @Customer('id') customerId: number,
    @Body() dto: CustomerChangePasswordDto,
  ) {
    await this.customerService.changePassword(customerId, dto);
    return successfulResult(['t.The password has been successfully updated']);
  }

  /**
   * --------------------------------------------------------
   */
  @Post('password/forgot')
  async forgotPassword(@Body() dto: CustomerForgotDto) {
    await this.customerService.forgotPassword(dto);
    return successfulResult(['t.The verification code has been sent']);
  }

  /**
   * --------------------------------------------------------
   */
  @Post('password/reset')
  async resetPassword(@Body() dto: CustomerResetPasswordDto) {
    const response = await this.customerService.resetPasswordByToken(dto);

    return successfulResult(
      ['Your password has been successfully changed'],
      response || {},
    );
  }

  /**
   * --------------------------------------------------------
   * POST /customers/signup
   */
  @Post('signup')
  async signup(@Body() dto: CustomerSignupDto) {
    const response = await this.customerService.signup(dto);
    return successfulResult(
      ['t.The verification code has been sent'],
      response,
    );
  }

  /**
   * -------------------------------------------------------
   * POST /customers/signup/verify
   */
  @Post('signup/verify')
  async verifySignupByCode(@Body() dto: CustomerVerifySignupDto) {
    const response = await this.customerService.verifySignupByCode(dto);

    return successfulResult(
      ['t.Your account has been verified'],
      response || {},
    );
  }

  /**
   * -------------------------------------------------------
   * POST /customers/resend-otp-code
   */
  @Post('resend-otp-code')
  async sendOtpCode(@Body() dto: CustomerResendOtpDto) {
    await this.customerService.sendOtpCode(dto);

    return successfulResult(['t.The verification code has been sent again']);
  }

  /**
   * -------------------------------------------------------
   * GET /customers/admin
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  @ApiQuery({ name: 'first_name', required: false })
  @ApiQuery({ name: 'last_name', required: false })
  @ApiQuery({ name: 'mobile', required: false })
  @ApiQuery({ name: 'email', required: false })
  @ApiQuery({ name: 'status', required: false, enum: CustomerStatus })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAllForAdmin(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter([
      'status',
      'mobile',
      'email',
      ['first_name', 'firstName'],
      ['last_name', 'lastName'],
    ])
    filters,
  ) {
    const list = await this.customerService.getAllForAdmin(
      page,
      limit,
      filters,
      sorts,
    );

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /customers/:id/admin
   */
  @Get(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  async getByIdForAdmin(@Param('id') customerId: number) {
    const data = await this.customerService.getByIdForAdmin(customerId);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * POST /customers/admin
   */
  @Post('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @HttpCode(HttpStatus.CREATED)
  async add(@Body() dto: CreateCustomerDto) {
    const newCustomer = await this.customerService.add(dto);

    return successfulResult(
      ['t.The customer is created successfully'],
      newCustomer,
    );
  }

  /**
   * -------------------------------------------------------
   * PUT /customers/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async update(@Body() dto: UpdateCustomerDto) {
    await this.customerService.update(dto);

    return successfulResult(['t.The customer is updated successfully']);
  }

  /**
   * -------------------------------------------------------
   * DELETE /customers/:id/admin
   */
  @Delete(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async delete(@Param('id') customerId: number, @Query('force') force) {
    await this.customerService.delete(customerId, force);

    return successfulResult(['t.The customer is deleted']);
  }

  /**
   * -------------------------------------------------------
   * show chart of customers
   * GET /customers/statistic/chart/admin
   */
  @Get('statistic/chart/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiQuery({ name: 'type', required: true, enum: ['daily', 'monthly'] })
  async statisticChart(
    @Query('from') from,
    @Query('to') to,
    @Query('type') type,
  ) {
    const data = await this.customerService.statisticChart(from, to, type);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * Show count of customers
   * GET /customers/statistic/count/admin
   */
  @Get('statistic/count/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async statisticCount() {
    const data = await this.customerService.statisticCount();
    return successfulResult([], data);
  }
}
