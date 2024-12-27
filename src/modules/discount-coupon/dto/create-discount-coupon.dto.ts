import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { DiscountCouponTypes } from '../entities/discount-coupon.entity';
import { convertPersianToEnglishDigit } from '../../../utils/persianNumbers';
import { Transform } from 'class-transformer';

export class CreateDiscountCouponDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(({ value }) =>
    convertPersianToEnglishDigit(value.trim().toUpperCase()),
  )
  code: string;

  @ApiProperty({ required: false })
  @IsOptional()
  customerId: number;

  @ApiProperty({ enum: DiscountCouponTypes })
  @IsIn(Object.values(DiscountCouponTypes))
  @IsNotEmpty()
  type: DiscountCouponTypes;

  @ApiProperty({ required: true })
  @IsNotEmpty()
  amount: number;

  @ApiProperty({ required: false })
  @IsOptional()
  startAt: string;

  @ApiProperty({ required: false })
  @IsOptional()
  endAt: string;

  @ApiProperty({ required: true })
  @IsNotEmpty()
  maxUseCount: number;

  @ApiProperty({ required: true })
  @IsNotEmpty()
  maxUseCountPerUser: number;

  @ApiProperty({ required: false })
  @IsOptional()
  maxDiscountAmount: number;

  @ApiProperty({ required: false })
  @IsOptional()
  minPurchaseAmount: number;

  @ApiProperty({ required: true })
  @IsNotEmpty()
  isActive: boolean;
}
