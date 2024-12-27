import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';
import { convertPersianToEnglishDigit } from '../../../utils/persianNumbers';

export class AuthResetPasswordDto {
  @ApiProperty()
  @Transform(({ value }) =>
    convertPersianToEnglishDigit(`${value}`.toLowerCase().trim(), true),
  )
  @IsNotEmpty()
  code: string;

  @ApiProperty({ example: 'Abab@#12' })
  @IsNotEmpty()
  newPassword: string;

  @ApiProperty({ example: '' })
  @Transform(({ value }) => value.toLowerCase().trim())
  @IsNotEmpty()
  emailOrMobile: string;
}
