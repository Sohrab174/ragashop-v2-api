import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  convertPersianToEnglishDigit,
  convertToStandardMobileFormat,
} from '../../../utils/persianNumbers';

export class CustomerVerifySignupDto {
  @ApiProperty()
  @Transform(({ value }) =>
    convertPersianToEnglishDigit(`${value}`.toLowerCase().trim(), true),
  )
  @IsNotEmpty()
  code: string;

  @ApiProperty()
  @ValidateIf((p) => !p.mobile)
  @Transform(({ value }) =>
    convertPersianToEnglishDigit(`${value}`.toLowerCase().trim()),
  )
  @IsNotEmpty()
  @IsEmail(
    {},
    {
      message: 'The email is invalid',
    },
  )
  email: string;

  @ApiProperty()
  @ValidateIf((p) => !p.email)
  @Transform(({ value }) => convertToStandardMobileFormat(value))
  @IsNotEmpty()
  mobile: string;
}
