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
    message: 'This email is already registered',
  })
  @IsEmail(
    {},
    {
      message: 'The email is invalid',
    },
  )
  email: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(({ value }) => convertToStandardMobileFormat(value))
  @Validate(IsNotExist, ['UserEntity'], {
    message: 'This mobile is already registered',
  })
  mobile?: string;
}
