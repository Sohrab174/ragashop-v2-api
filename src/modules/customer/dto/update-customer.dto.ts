import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

import { CustomerStatus } from '../entities/customer.entity';
import {
  convertPersianToEnglishDigit,
  convertToStandardMobileFormat,
} from '../../../utils/persianNumbers';

export class UpdateCustomerDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty()
  @Transform(({ value }) => value.trim())
  @IsNotEmpty()
  firstName: string;

  @ApiProperty()
  @Transform(({ value }) => value.trim())
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'test1@example.com' })
  @ValidateIf((p) => !p.mobile)
  @IsNotEmpty()
  @Transform(({ value }) =>
    convertPersianToEnglishDigit(`${value}`.toLowerCase().trim()),
  )
  @IsEmail(
    {},
    {
      message: 'ایمیل وارد شده نامعتبر است',
    },
  )
  email: string;

  @ApiProperty({ example: '' })
  @ValidateIf((p) => !p.email)
  @Transform(({ value }) => convertToStandardMobileFormat(value))
  @IsNotEmpty()
  mobile: string;

  @ApiProperty()
  @Transform(({ value }) => value.trim())
  @IsOptional()
  password: string;

  @ApiProperty({ required: true, enum: CustomerStatus })
  @IsNotEmpty()
  @IsIn(Object.values(CustomerStatus))
  status: CustomerStatus;

  @ApiProperty({ required: false })
  @Transform(({ value }) => (value || '').toLowerCase().trim())
  @IsOptional()
  referrerCode: string;

  @ApiProperty({ required: false })
  @IsOptional()
  buyPercentToReferrerCreditUSD: number;

  @ApiProperty({ required: false })
  @IsOptional()
  buyPercentToReferrerCreditIRT: number;

  @ApiProperty({ required: false })
  @IsOptional()
  buyPercentToReferrerCreditTRY: number;
}
