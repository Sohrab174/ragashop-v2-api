import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty } from 'class-validator';
import { convertPersianToEnglishDigit } from '../../../utils/persianNumbers';

export class AuthForgotDto {
  @ApiProperty({ example: '' })
  @Transform(({ value }) =>
    convertPersianToEnglishDigit(`${value}`.toLowerCase().trim()),
  )
  @IsNotEmpty()
  emailOrMobile: string;
}
