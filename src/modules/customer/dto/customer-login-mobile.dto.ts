import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';
import { convertToStandardMobileFormat } from '../../../utils/persianNumbers';

export class CustomerLoginMobileDto {
  @ApiProperty()
  @IsNotEmpty()
  @Transform(({ value }) => convertToStandardMobileFormat(value))
  // @Matches(/^09\d{9}$/, { message: 'لطفا یک شماره موبایل معتبر وارد نمایید' })
  mobile: string;
}
