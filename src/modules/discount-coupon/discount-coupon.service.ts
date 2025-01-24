import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { CreateDiscountCouponDto } from './dto/create-discount-coupon.dto';
import { UpdateDiscountCouponDto } from './dto/update-discount-coupon.dto';
import {
  DiscountCouponEntity,
  DiscountCouponTypes,
} from './entities/discount-coupon.entity';
import { ErrorService } from '../../error/error.service';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  digit,
  generateRandomAlphaDigitCode,
  paginationResult,
} from '../../utils';
import { DiscountCouponUsedEntity } from './entities/discount-coupon-used.entity';
import { UserEntity } from '../user/entities/user.entity';
import { CustomerService } from '../customer/customer.service';

@Injectable()
export class DiscountCouponService {
  constructor(
    @InjectRepository(DiscountCouponEntity)
    private discountCouponRepository: Repository<DiscountCouponEntity>,

    @InjectRepository(DiscountCouponUsedEntity)
    private discountCouponUsedRepository: Repository<DiscountCouponUsedEntity>,

    private error: ErrorService,

    @Inject(forwardRef(() => CustomerService))
    private customerService: CustomerService,
  ) {}

  /**
   * --------------------------------------------------------
   * POST /discount-coupons/admin
   */
  async addNew(dto: CreateDiscountCouponDto, user: UserEntity) {
    if (dto.code) {
      const countCouponByCode = await this.discountCouponRepository.count({
        code: dto.code,
      });
      if (countCouponByCode > 0) {
        this.error.unprocessableEntity(['این کد تخفیف قبلا ثبت شده است']);
      }
    }

    if (dto.customerId) {
      const customer = await this.customerService.getRecordById(dto.customerId);
      if (!customer) {
        this.error.unprocessableEntity(['مشتری مورد نظر یافت نشد!']);
      }
    }

    const { identifiers } = await this.discountCouponRepository
      .createQueryBuilder()
      .insert()
      .values({
        ...dto,
        createdByUserId: user.id,
        createdAt: new Date(),
        ...(!dto.code && { code: await this._generateCode() }),
      })
      .execute();

    const newDiscountCoupon = identifiers[0].id;
    return await this.discountCouponRepository.findOne(newDiscountCoupon);
  }

  /**
   * --------------------------------------------------------
   * GET /discount-coupons/admin
   */
  async list(page = 1, limit = 20, filters = null, sorts = null) {
    let builder = this.discountCouponRepository.createQueryBuilder('coupon');

    builder.leftJoin('coupon.customer', 'customer');
    builder.addSelect([
      'customer.id',
      'customer.firstName',
      'customer.lastName',
      'customer.mobile',
    ]);

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('coupon.createdAt', 'DESC');
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
   * --------------------------------------------------------
   * GET /discount-coupons/1/admin
   */
  async getById(id: number) {
    const builder = this.discountCouponRepository.createQueryBuilder('coupon');

    builder.leftJoin('coupon.customer', 'customer');
    builder.addSelect([
      'customer.id',
      'customer.firstName',
      'customer.lastName',
      'customer.mobile',
    ]);

    builder.andWhere({ id });

    return await builder.getOne();
  }

  /**
   * --------------------------------------------------------
   */
  async getRecordById(id: number) {
    return await this.discountCouponRepository.findOne(id);
  }

  /**
   * --------------------------------------------------------
   * PUT /discount-coupons/admin
   */
  async updateById(dto: UpdateDiscountCouponDto) {
    if (dto.code) {
      const countCouponByCode = await this.discountCouponRepository.count({
        code: dto.code,
        id: Not(dto.id),
      });
      if (countCouponByCode > 0) {
        this.error.unprocessableEntity(['این کد تخفیف قبلا ثبت شده است']);
      }
    }

    if (dto.customerId) {
      const customer = await this.customerService.getRecordById(dto.customerId);
      if (!customer) {
        this.error.unprocessableEntity(['مشتری مورد نظر یافت نشد!']);
      }
    }

    const builder = this.discountCouponRepository
      .createQueryBuilder()
      .update()
      .set(dto)
      .where({ id: dto.id });

    await builder.execute();
  }

  /**
   * -------------------------------------------------------
   * DELETE /discount-coupons/1/admin
   */
  async deleteById(id: number) {
    try {
      const builder = this.discountCouponRepository
        .createQueryBuilder()
        .delete()
        .where({ id });

      await builder.execute();
    } catch (e) {
      this.error.methodNotAllowed([
        'بدلیل استفاده از این کد تخفیف، امکان حذف آن، وجود ندارد',
      ]);
    }
  }

  /**
   * -------------------------------------------------------
   */
  async findValidByCode(code: string, customerId: number = null) {
    const coupon = await this.discountCouponRepository.findOne({
      code,
      isActive: true,
    });

    if (!coupon) {
      this.error.methodNotAllowed(['کد تخفیف مورد نظر معتبر نمی‌باشد']);
    }

    if (coupon.customerId && coupon.customerId !== customerId) {
      this.error.methodNotAllowed(['این کد تخفیف متعلق به شخص دیگری است']);
    }

    // TODO:
    // check birthday used in one year before

    const dateNow = new Date();
    if (coupon.startAt && coupon.startAt > dateNow) {
      this.error.methodNotAllowed(['زمان شروع این کد تخفیف فرا نرسیده است']);
    }
    if (coupon.endAt && coupon.endAt < dateNow) {
      this.error.methodNotAllowed(['مدت زمان این کد تخفیف به پایان رسیده است']);
    }

    if (coupon.maxUseCount !== -1 && coupon.usedCount >= coupon.maxUseCount) {
      this.error.methodNotAllowed([
        coupon.customerId
          ? 'شما قبلا از این کد تخفیف استفاده کرده‌اید'
          : 'متاسفم، تعداد دفعات استفاده از این کد تخفیف به اتمام رسیده است',
      ]);
    }

    if (coupon.maxUseCountPerUser !== -1 && customerId) {
      const countUsedPerUser = await this.discountCouponUsedRepository.count({
        customerId,
        discountCouponId: coupon.id,
      });

      if (countUsedPerUser >= coupon.maxUseCountPerUser) {
        this.error.methodNotAllowed([
          'شما قبلا از این کد تخفیف استفاده کرده‌اید',
        ]);
      }
    }

    return coupon;
  }

  /**
   * -------------------------------------------------------
   */
  async calculateDiscountByCouponCode(
    code: string,
    amount: number,
    customerId: number = null,
    increaseUsedCount = false,
  ) {
    const coupon = await this.findValidByCode(code, customerId);

    if (
      amount &&
      coupon.minPurchaseAmount &&
      amount < coupon.minPurchaseAmount
    ) {
      this.error.methodNotAllowed([
        `حداقل مبلغ اقلام سفارش ${digit(coupon.minPurchaseAmount)} می‌باشد`,
      ]);
    }

    let discountAmount = 0;

    if (coupon.type === DiscountCouponTypes.fixedAmount) {
      discountAmount = coupon.amount;
    }
    //
    else if (coupon.type === DiscountCouponTypes.percentage) {
      discountAmount = Math.ceil((coupon.amount * amount) / 100);

      if (
        coupon.maxDiscountAmount &&
        discountAmount > coupon.maxDiscountAmount
      ) {
        discountAmount = coupon.maxDiscountAmount;
      }
    }

    discountAmount = discountAmount > amount ? amount : discountAmount;

    // increase used count and insert new used record
    let couponUsedId = null;
    if (increaseUsedCount) {
      coupon.usedCount = coupon.usedCount + 1;
      coupon.updatedAt = new Date();
      await coupon.save();

      if (customerId) {
        const { identifiers } = await this.discountCouponUsedRepository
          .createQueryBuilder()
          .insert()
          .values({
            discountCouponId: coupon.id,
            customerId,
            discountAmount,
            createdAt: new Date(),
          })
          .execute();
        couponUsedId = identifiers[0].id;
      }
    }

    return {
      id: coupon.id,
      usedId: couponUsedId,
      discountAmount,
      finalAmount: amount - discountAmount,
      type: coupon.type,
      fixedAmount:
        coupon.type === DiscountCouponTypes.fixedAmount ? coupon.amount : null,
      percentage:
        coupon.type === DiscountCouponTypes.percentage ? coupon.amount : null,
    };
  }

  /**
   * --------------------------------------------------------
   */
  private async _generateCode(length = 8) {
    while (true) {
      const newCode = generateRandomAlphaDigitCode(length);
      if (newCode.charAt(0) === '0') continue;

      const count = await this.discountCouponRepository.count({
        code: newCode,
      });
      if (count === 0) {
        return newCode;
      }
    }
  }
}
