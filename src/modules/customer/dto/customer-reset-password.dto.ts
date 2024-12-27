import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';
import { convertPersianToEnglishDigit } from '../../../utils/persianNumbers';

export class CustomerResetPasswordDto {
  @ApiProperty()
  @Transform(({ value }) => value.trim())
  @IsNotEmpty()
  code: string;

  @ApiProperty({ example: 'Abab@#12' })
  @IsNotEmpty()
  newPassword: string;

  @ApiProperty({ example: '' })
  @Transform(({ value }) =>
    convertPersianToEnglishDigit(`${value}`.toLowerCase().trim()),
  )
  @IsNotEmpty()
  emailOrMobile: string;
}
