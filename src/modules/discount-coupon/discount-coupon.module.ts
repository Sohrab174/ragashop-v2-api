import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DiscountCouponEntity } from './entities/discount-coupon.entity';
import { DiscountCouponController } from './discount-coupon.controller';
import { DiscountCouponService } from './discount-coupon.service';
import { DiscountCouponUsedEntity } from './entities/discount-coupon-used.entity';
import { CustomerModule } from '../customer/customer.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DiscountCouponEntity, DiscountCouponUsedEntity]),
    forwardRef(() => CustomerModule),
  ],
  controllers: [DiscountCouponController],
  providers: [DiscountCouponService],
  exports: [DiscountCouponService],
})
export class DiscountCouponModule {}
