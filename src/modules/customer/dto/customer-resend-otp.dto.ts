import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  convertPersianToEnglishDigit,
  convertToStandardMobileFormat,
} from '../../../utils/persianNumbers';

export class CustomerResendOtpDto {
  @ApiProperty()
  @ValidateIf((p) => !p.mobile)
  @Transform(({ value }) =>
    convertPersianToEnglishDigit(`${value}`.toLowerCase().trim()),
  )
  @IsNotEmpty()
  @IsEmail(
    {},
    {
      message: 'ایمیل وارد شده نامعتبر است',
    },
  )
  email: string;

  @ApiProperty()
  @ValidateIf((p) => !p.email)
  @Transform(({ value }) => convertToStandardMobileFormat(value))
  @IsNotEmpty()
  mobile: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsIn(['signup', 'forgot', 'login'])
  type: 'signup' | 'forgot' | 'login';
}
