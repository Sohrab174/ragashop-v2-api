import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, Validate } from 'class-validator';
import { Transform } from 'class-transformer';
import { IsNotExist } from '../../../utils/validators/is-not-exists.validator';
import {
  convertPersianToEnglishDigit,
  convertToStandardMobileFormat,
} from '../../../utils/persianNumbers';

export class AuthUpdateDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty({ required: false })
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ required: false })
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ required: false })
  @IsNotEmpty()
  @Transform(({ value }) =>
    convertPersianToEnglishDigit(`${value}`.toLowerCase().trim()),
  )
  @Validate(IsNotExist, ['UserEntity'], {
    message: 'با این ایمیل قبلا ثبت نام انجام شده است',
  })
  @IsEmail(
    {},
    {
      message: 'ایمیل وارد شده نامعتبر است',
    },
  )
  email: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(({ value }) => convertToStandardMobileFormat(value))
  @Validate(IsNotExist, ['UserEntity'], {
    message: 'با این موبایل قبلا ثبت نام انجام شده است',
  })
  mobile?: string;
}
