import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional } from 'class-validator';
import { convertPersianToEnglishDigit } from '../../../utils/persianNumbers';
import { Transform } from 'class-transformer';

export class CalculateDiscountCouponDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  @Transform(({ value }) =>
    convertPersianToEnglishDigit(value.trim().toUpperCase()),
  )
  code: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(({ value }) => +convertPersianToEnglishDigit(value))
  amount: number;
}
