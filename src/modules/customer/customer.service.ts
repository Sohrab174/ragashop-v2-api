import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import * as moment from 'jalali-moment';
import { JwtService } from '@nestjs/jwt';

import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  paginationResult,
} from '../../utils';
import { ErrorService } from '../../error/error.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerEntity, CustomerStatus } from './entities/customer.entity';
import { OrderService } from '../order/order.service';
import { CustomerLoginDto } from './dto/customer-login.dto';
import { ConfigurationService } from '../../config/configuration.service';
import { CustomerSignupDto } from './dto/customer-signup.dto';
import { MailService } from '../../mail/mail.service';
import { CustomerUpdateMeDto } from './dto/customer-update-me.dto';
import { CustomerChangePasswordDto } from './dto/customer-change-password.dto';
import { CustomerVerifySignupDto } from './dto/customer-verify-signup.dto';
import { CustomerResetPasswordDto } from './dto/customer-reset-password.dto';
import { CustomerForgotDto } from './dto/customer-forgot.dto';
import { CustomerResendOtpDto } from './dto/customer-resend-otp.dto';
// import { AmootsmsService } from '../../sms/amootsms/amootsms.service';
import { KavenegarService } from '../../sms/kavenegar/kavenegar.service';
import { CustomerLoginMobileDto } from './dto/customer-login-mobile.dto';
import { CustomerLoginVerifyDto } from './dto/customer-login-verify.dto';

@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(CustomerEntity)
    private customerRepository: Repository<CustomerEntity>,

    private config: ConfigurationService,
    private jwtService: JwtService,
    private error: ErrorService,
    private mail: MailService,
    // private amootsmsService: AmootsmsService,
    private kavenegarService: KavenegarService,

    @Inject(forwardRef(() => OrderService))
    private orderService: OrderService,
  ) {}

  /**
   * --------------------------------------------------------
   */
  async login(dto: CustomerLoginDto) {
    const customer = await this.customerRepository
      .createQueryBuilder('customer')
      .andWhere('(customer.email = :eom OR customer.mobile = :eom)', {
        eom: dto.emailOrMobile,
      })
      .getOne();

    if (!customer) {
      this.error.unprocessableEntity([
        't.The username or password is incorrect',
      ]);
    }

    if (!(await customer.isCorrectSaltPassword(dto.password))) {
      this.error.unprocessableEntity([
        't.The username or password is incorrect',
      ]);
    }

    // if (customer.status === CustomerStatus.inactive) {
    //   this.error.unprocessableEntity([('t.Your account is inactive')]);
    // }

    return await this.prepareCustomerResponse(customer, dto.rememberMe);
  }

  /**
   * --------------------------------------------------------
   */
  async loginByMobile(dto: CustomerLoginMobileDto) {
    let customer = await this.customerRepository.findOne({
      mobile: dto.mobile,
    });

    let isNewUser = false;
    if (customer) {
      if (customer.status === CustomerStatus.banned) {
        this.error.methodNotAllowed([
          'حساب کاربری شما مسدود شده است، با پشتیبانی تماس حاصل نمایید',
        ]);
      }
      // The verification code has already been sent, please try again in a few minutes!
      else if (
        moment(customer.expireRandomHash)
          .subtract(2, 'minutes')
          .isAfter(moment())
      ) {
        return { mobile: customer.mobile };
      }
    } else {
      isNewUser = true;
      customer = new CustomerEntity();
      customer.mobile = dto.mobile;
      customer.status = CustomerStatus.inactive;
      customer.createdAt = new Date();
    }

    const randomHash =
      this.config.app.nodeEnv === 'production'
        ? await this._generateVerifyCode()
        : '11111';

    customer.randomHash = randomHash;
    customer.expireRandomHash = moment().add(5, 'minutes').toDate();
    await customer.save();

    // Sending SMS
    await this.kavenegarService.sendOTP(dto.mobile, customer.randomHash);

    return { mobile: dto.mobile, isNewUser };
  }

  /**
   * --------------------------------------------------------
   */
  async verifyLogin(dto: CustomerLoginVerifyDto) {
    const customer = await this.customerRepository.findOne({
      mobile: dto.mobile,
      randomHash: dto.code,
    });

    if (!(customer && moment(customer.expireRandomHash).isAfter(moment()))) {
      return this.error.unprocessableEntity([
        't.The verification code is invalid or expired',
      ]);
    }

    if (!customer.lastName) {
      if (!dto.firstName || !dto.lastName) {
        return this.error.unprocessableEntity([
          'لطفا نام و نام خانوادگی خود را وارد کنید',
        ]);
      } else {
        customer.firstName = dto.firstName;
        customer.lastName = dto.lastName;
      }
    }

    customer.randomHash = null;
    customer.expireRandomHash = null;
    customer.status = CustomerStatus.active;
    await customer.save();

    return await this.prepareCustomerResponse(customer, true);
  }

  /**
   * --------------------------------------------------------
   */
  async getActiveById(id: number) {
    const customer = await this.customerRepository.findOne({
      id,
      status: CustomerStatus.active,
    });

    if (customer) {
      delete customer?.password;
      delete customer?.previousPassword;
      delete customer?.randomHash;
      delete customer?.expireRandomHash;
    }

    return customer;
  }

  /**
   * --------------------------------------------------------
   */
  async getRecordById(id: number) {
    return await this.customerRepository.findOne({
      id,
    });
  }

  /**
   * --------------------------------------------------------
   */
  async updateMe(customerId: number, dto: CustomerUpdateMeDto) {
    return await this.customerRepository
      .createQueryBuilder()
      .update()
      .set(dto)
      .where({ id: customerId })
      .execute();
  }

  /**
   * --------------------------------------------------------
   */
  async changePassword(customerId: number, dto: CustomerChangePasswordDto) {
    const customer = await this.customerRepository.findOne(customerId);

    if (
      dto.oldPassword &&
      !(await customer.isCorrectSaltPassword(dto.oldPassword))
    ) {
      this.error.unprocessableEntity(['t.The current password is incorrect']);
    }

    customer.password = dto.newPassword;
    await customer.save();

    return customer;
  }

  /**
   * --------------------------------------------------------
   */
  async forgotPassword(dto: CustomerForgotDto) {
    const customer = await this.customerRepository
      .createQueryBuilder('customer')
      .andWhere('(customer.email = :eom OR customer.mobile = :eom)', {
        eom: dto.emailOrMobile,
      })
      .andWhere({ status: CustomerStatus.active })
      .getOne();

    if (!customer) {
      this.error.unprocessableEntity(['t.The customer was not found!']);
    }

    if (moment(customer.expireRandomHash).isAfter(moment())) {
      this.error.unprocessableEntity([
        't.The verification code has already been sent, please try again in a few minutes!',
      ]);
    }

    await this.sendOtpCode({
      email: customer.email,
      mobile: customer.mobile,
      type: 'forgot',
    });

    return true;
  }

  /**
   * --------------------------------------------------------
   */
  async resetPasswordByToken(dto: CustomerResetPasswordDto) {
    const customer = await this.customerRepository
      .createQueryBuilder('customer')
      .andWhere('(customer.email = :eom OR customer.mobile = :eom)', {
        eom: dto.emailOrMobile,
      })
      .andWhere({ status: CustomerStatus.active })
      .getOne();

    if (!customer) {
      this.error.unprocessableEntity(['t.The customer was not found!']);
    }

    if (
      customer.randomHash !== dto.code ||
      !moment(customer.expireRandomHash).isAfter(moment())
    ) {
      return this.error.unprocessableEntity([
        't.The verification code is invalid or expired',
      ]);
    }

    customer.randomHash = null;
    customer.expireRandomHash = null;
    customer.password = dto.newPassword;
    await customer.save();

    return await this.prepareCustomerResponse(customer, false);
  }

  /**
   * --------------------------------------------------------
   * Preparing the customer info and an access token for responding to signup and login requests
   * Generating the JWT access token, if the customer is verified
   */
  async prepareCustomerResponse(customer: CustomerEntity, rememberMe = false) {
    const accessToken = await this._generateAccessToken(customer, rememberMe);

    return {
      customer: {
        id: customer.id,
        email: customer.email,
        mobile: customer.mobile,
        fullName: `${customer.firstName} ${customer.lastName}`.trim(),
        firstName: customer.firstName,
        lastName: customer.lastName,
      },
      accessToken,
    };
  }

  /**
   * --------------------------------------------------------
   * Generating the JWT access token based on the customer's ID and email
   */
  private async _generateAccessToken(
    customer: CustomerEntity,
    rememberMe = false,
  ) {
    return await this.jwtService.sign(
      {
        id: customer.id,
        email: customer.email,
        mobile: customer.mobile,
        role: 'customer',
      },
      {
        expiresIn: rememberMe
          ? this.config.auth.expiresLifetime
          : this.config.auth.expires,
      },
    );
  }

  /**
   * --------------------------------------------------------
   */
  async signup(dto: CustomerSignupDto) {
    // Checking unique email in this company
    if (dto.email) {
      const customer = await this.customerRepository.findOne({
        email: dto.email,
      });
      if (customer) {
        if (customer.status === CustomerStatus.inactive) {
          return await this.sendOtpCode({
            email: dto.email,
            mobile: dto.mobile,
            type: 'signup',
          });
        } else {
          this.error.unprocessableEntity([
            't.This email has already been used',
          ]);
        }
      }
    }

    // Checking unique mobile number in this company
    if (dto.mobile) {
      const customer = await this.customerRepository.findOne({
        mobile: dto.mobile,
      });
      if (customer) {
        if (customer.status === CustomerStatus.inactive) {
          return await this.sendOtpCode({
            email: dto.email,
            mobile: dto.mobile,
            type: 'signup',
          });
        } else {
          this.error.unprocessableEntity([
            't.This mobile has already been used',
          ]);
        }
      }
    }

    const newCustomer = new CustomerEntity();
    for (const key in dto) {
      newCustomer[key] = dto[key];
    }

    newCustomer.status = CustomerStatus.inactive;
    newCustomer.randomHash = await this._generateVerifyCode();
    newCustomer.expireRandomHash = moment().add(5, 'minutes').toDate();
    newCustomer.createdAt = new Date();

    const { identifiers } = await this.customerRepository
      .createQueryBuilder()
      .insert()
      .values(newCustomer)
      .execute();

    // Sending SMS
    await this.kavenegarService.sendOTP(dto.mobile, newCustomer.randomHash);

    const newCustomerId = identifiers[0].id;
    return { id: newCustomerId };
  }

  /**
   * --------------------------------------------------------
   */
  async sendOtpCode(dto: CustomerResendOtpDto) {
    const where: any = {};

    if (dto.type === 'signup') {
      where.status = CustomerStatus.inactive;
    } else if (dto.type === 'forgot') {
      where.status = CustomerStatus.active;
    } else if (dto.type === 'login') {
      //
    }

    if (dto.mobile) {
      where.mobile = dto.mobile;
    }
    if (dto.email) {
      where.email = dto.email;
    }

    const customer = await this.customerRepository.findOne(where);
    if (!customer) {
      this.error.unprocessableEntity([
        't.Resending the confirmation code requires initial registration, your information is not registered in the system!',
      ]);
    }

    if (!customer) {
      this.error.unprocessableEntity(['t.The request is invalid!']);
    }

    if (
      moment(customer.expireRandomHash).subtract(2, 'minutes').isAfter(moment())
    ) {
      this.error.unprocessableEntity([
        't.The verification code has already been sent, please try again in a few minutes!',
      ]);
    }

    customer.randomHash = await this._generateVerifyCode();
    customer.expireRandomHash = moment().add(5, 'minutes').toDate();
    await customer.save();

    // Sending SMS
    await this.kavenegarService.sendOTP(dto.mobile, customer.randomHash);

    return true;
  }

  /**
   * --------------------------------------------------------
   */
  async verifySignupByCode(dto: CustomerVerifySignupDto) {
    const customer = await this.findByValidHashCode(
      dto.code,
      dto.email,
      dto.mobile,
      CustomerStatus.inactive,
    );

    if (!customer) {
      return this.error.unprocessableEntity([
        't.The verification code is invalid or expired',
      ]);
    }

    customer.randomHash = null;
    customer.expireRandomHash = null;
    customer.status = CustomerStatus.active;
    await customer.save();

    return await this.prepareCustomerResponse(customer, false);
  }

  /**
   * -------------------------------------------------------
   * GET /customers/admin
   */
  async getAllForAdmin(page = 1, limit = 20, filters = null, sorts = null) {
    let builder = this.customerRepository.createQueryBuilder('customer');

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('customer.createdAt', 'DESC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    const [items, totalItems] = await builder
      .take(limit)
      .skip((page - 1) * limit)
      .getManyAndCount();

    return {
      items: items.map((item) => {
        delete item.password;
        delete item.previousPassword;
        delete item.randomHash;
        return item;
      }),
      pagination: paginationResult(page, limit, totalItems),
    };
  }

  /**
   * -------------------------------------------------------
   * GET /customers/:id/admin
   */
  async getByIdForAdmin(id: number) {
    const builder = this.customerRepository
      .createQueryBuilder('customer')

      .where({ id });

    const customer = await builder.getOne();

    if (!customer) {
      this.error.unprocessableEntity(['t.The customer was not found!']);
    }

    return customer;
  }

  /**
   * -------------------------------------------------------
   * POST /customers/admin
   */
  async add(dto: CreateCustomerDto) {
    // Checking unique email in this company
    if (
      dto.email &&
      (await this.customerRepository.findOne({ email: dto.email }))
    ) {
      this.error.unprocessableEntity(['t.This email has already been used']);
    }

    // Checking unique mobile number in this company
    if (
      dto.mobile &&
      (await this.customerRepository.findOne({ mobile: dto.mobile }))
    ) {
      this.error.unprocessableEntity(['t.This mobile has already been used']);
    }

    // Creating a new customer
    const { identifiers } = await this.customerRepository
      .createQueryBuilder()
      .insert()
      .values({
        ...dto,
        createdAt: new Date(),
      })
      .execute();

    const newCustomerId = identifiers[0].id;

    return { id: newCustomerId };
  }

  /**
   * -------------------------------------------------------
   * PUT /customers/admin
   */
  async update(dto: UpdateCustomerDto) {
    const customer = await this.customerRepository.findOne({
      where: { id: dto.id },
    });

    if (!customer) {
      this.error.unprocessableEntity(['t.The customer was not found!']);
    }

    // Checking unique email in this company
    if (
      dto.email &&
      (await this.customerRepository.findOne({
        email: dto.email,
        id: Not(dto.id),
      }))
    ) {
      this.error.unprocessableEntity(['t.This email has already been used']);
    }

    // Checking unique mobile number in this company
    if (
      dto.mobile &&
      (await this.customerRepository.findOne({
        mobile: dto.mobile,
        id: Not(dto.id),
      }))
    ) {
      this.error.unprocessableEntity(['t.This mobile has already been used']);
    }

    // Updating the customer
    customer.firstName = dto.firstName;
    customer.lastName = dto.lastName;
    customer.mobile = dto.mobile;
    customer.email = dto.email;
    customer.status = dto.status;

    if (dto.password) {
      customer.password = dto.password;
    }

    await customer.save();

    return true;
  }

  /**
   * -------------------------------------------------------
   * DELETE /customers/:id/admin
   */
  async delete(id: number, force: string) {
    const customer = await this.customerRepository.findOne({
      where: { id },
    });

    if (!customer) {
      this.error.unprocessableEntity(['t.The customer was not found!']);
    }

    try {
      if (force === '1') {
        await this.orderService.deleteByCustomerId(id);
      }

      await customer.remove();
    } catch (err) {
      this.error.methodNotAllowed(
        [
          't.Some orders and reserves are related to this customer. Are you sure you want to delete it?',
        ],
        { hasDependencies: true },
      );
    }
  }

  /**
   * --------------------------------------------------------
   */
  async findByValidHashCode(
    randomHash: string,
    email = null,
    mobile = null,
    status: CustomerStatus = null,
  ) {
    const where = { randomHash, ...(status && { status }) } as any;

    if (mobile) {
      where.mobile = mobile;
    }
    if (email) {
      where.email = email;
    }

    const customer = await this.customerRepository.findOne(where);
    if (customer && moment(customer.expireRandomHash).isAfter(moment())) {
      return customer;
    }
    return false;
  }

  /**
   * --------------------------------------------------------
   */
  private async _generateVerifyCode() {
    while (true) {
      const randomNumber = String(Math.floor(10000 + Math.random() * 90000));

      const user = await this.findByValidHashCode(randomNumber);
      if (!user) {
        return randomNumber;
      }
    }
  }

  /**
   * -------------------------------------------------------
   * show chart of customers
   * GET /customers/statistic/chart/admin
   */
  async statisticChart(from, to, type = 'daily') {
    const list = await this.customerRepository
      .createQueryBuilder()
      .groupBy('DAY(createdAt), MONTH(createdAt)')
      .select([
        'COUNT(id) AS cnt',
        'DAY(createdAt) AS day',
        'MONTH(createdAt) AS month',
        'DATE(createdAt) AS date',
      ])
      .andWhere({ status: CustomerStatus.active })
      .andWhere('DATE(createdAt) BETWEEN :from AND :to', {
        from,
        to,
      })
      .orderBy('createdAt', 'ASC')
      .getRawMany();

    const mapping = list.map((item) => ({
      count: +item.cnt,
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
        count: (obj[+m]?.count || 0) + item.count,
      };
    });

    return Object.values(obj).sort((a: any, b: any) => a.month - b.month);
  }

  /**
   * -------------------------------------------------------
   * Show count of customers
   * GET /customers/statistic/count/admin
   */
  async statisticCount() {
    const { active, inactive } = await this.customerRepository
      .createQueryBuilder('customer')
      .select([
        `SUM(IF(customer.status = '${CustomerStatus.active}', 1, 0)) AS active`,
        `SUM(IF(customer.status = '${CustomerStatus.inactive}', 1, 0)) AS inactive`,
      ])
      .getRawOne();

    return {
      active: +active,
      inactive: +inactive,
    };
  }
}
