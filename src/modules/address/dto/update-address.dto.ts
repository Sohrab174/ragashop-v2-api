import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { prettyText } from '../../../utils';

export class UpdateAddressDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty({ required: true })
  @IsNotEmpty({ message: 'عنوان آدرس اجباری است' })
  @IsString()
  @MaxLength(45, {
    message: 'عنوان آدرس وارد شده طولانی است، مثال: خانه یا محل کار',
  })
  @Transform(({ value }) => prettyText(value))
  title: string;

  @ApiProperty({ required: true })
  @IsBoolean()
  isDefault: boolean;

  @ApiProperty({ required: true })
  @IsNotEmpty({ message: 'آدرس اجباری است' })
  @IsString()
  @Transform(({ value }) => prettyText(value))
  address: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Transform(({ value }) => (value == null ? value : prettyText(value)))
  details?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(45)
  @Transform(({ value }) => (value == null ? value : prettyText(value)))
  postalCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(45)
  location?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  latitude?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  longitude?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  cityId?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value == null ? value : prettyText(value)))
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(45, { message: 'نام گیرنده طولانی است' })
  @Transform(({ value }) => (value == null ? value : prettyText(value)))
  recipientFirstName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(45, { message: 'نام خانوادگی گیرنده طولانی است' })
  @Transform(({ value }) => (value == null ? value : prettyText(value)))
  recipientLastName?: string;
}
