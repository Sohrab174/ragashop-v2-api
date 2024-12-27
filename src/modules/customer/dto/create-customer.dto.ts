import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

import { CustomerStatus } from '../entities/customer.entity';
import {
  convertPersianToEnglishDigit,
  convertToStandardMobileFormat,
} from '../../../utils/persianNumbers';

export class CreateCustomerDto {
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
      message: 'The email is invalid',
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
  @IsNotEmpty()
  password: string;

  @ApiProperty({ required: true, enum: CustomerStatus })
  @IsNotEmpty()
  @IsIn(Object.values(CustomerStatus))
  status: CustomerStatus;
}
