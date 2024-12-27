import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  convertPersianToEnglishDigit,
  convertToStandardMobileFormat,
} from '../../../utils/persianNumbers';

export class CustomerSignupDto {
  @ApiProperty({ example: '' })
  @Transform(({ value }) => value.trim())
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: '' })
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

  @ApiProperty({ example: '1234567' })
  @Transform(({ value }) => value.trim())
  @IsNotEmpty()
  password: string;
}
