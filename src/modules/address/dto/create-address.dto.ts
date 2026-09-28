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

/**
 * Existing address-book create contract, plus optional checkout recipient names.
 * Location, details, and postal code stay optional so checkout-aligned saves
 * do not invent a map pin. Legacy clients may still send them.
 */
export class CreateAddressDto {
  @ApiProperty({ required: true })
  @IsNotEmpty({ message: 'عنوان آدرس اجباری است' })
  @MaxLength(45, {
    message: 'عنوان آدرس وارد شده طولانی است، مثال: خانه یا محل کار',
  })
  @IsString()
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
  @MaxLength(45)
  @Transform(({ value }) => (value == null ? value : prettyText(value)))
  postalCode?: string;

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
  location?: string;

  @ApiProperty({ required: false, description: 'WGS84 latitude (-90..90)' })
  @IsOptional()
  latitude?: number;

  @ApiProperty({ required: false, description: 'WGS84 longitude (-180..180)' })
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
