import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  convertPersianToEnglishDigit,
  convertToStandardMobileFormat,
} from '../../../utils/persianNumbers';

export class CustomerLoginVerifyDto {
  @ApiProperty()
  @Transform(({ value }) => convertToStandardMobileFormat(value))
  // @Matches(/^09\d{9}$/, { message: 'لطفا یک شماره موبایل معتبر وارد نمایید' })
  @IsNotEmpty()
  mobile: string;

  @ApiProperty()
  @Transform(({ value }) => convertPersianToEnglishDigit(value.trim(), true))
  @IsNotEmpty()
  code: string;

  @ApiProperty({ required: false })
  @Transform(({ value }) => value.trim())
  @IsOptional()
  firstName: string;

  @ApiProperty({ required: false })
  @Transform(({ value }) => value.trim())
  @IsOptional()
  lastName: string;

  @ApiProperty({ required: false })
  @Transform(({ value }) => convertPersianToEnglishDigit((value || '').trim()))
  @IsOptional()
  inviteCode: string;
}
