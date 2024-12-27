import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';
import { convertPersianToEnglishDigit } from '../../../utils/persianNumbers';

export class CustomerLoginDto {
  @ApiProperty({ example: '' })
  @Transform(({ value }) =>
    convertPersianToEnglishDigit(`${value}`.toLowerCase().trim()),
  )
  @IsNotEmpty()
  emailOrMobile: string;

  @ApiProperty({ example: '1234567' })
  @Transform(({ value }) => value.trim())
  @IsNotEmpty()
  password: string;

  @ApiProperty()
  @IsNotEmpty()
  rememberMe: boolean;
}
