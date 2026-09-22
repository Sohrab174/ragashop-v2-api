import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Checkout create body.
 * Intentionally omits prices/totals — server derives from owned Cart.
 */
export class CreateCheckoutOrderDto {
  @ApiProperty({
    description:
      'Confirmation token from GET /checkout. Required to prevent silent price/cart changes.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  confirmationToken: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(45)
  firstName: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(45)
  lastName: string;

  @ApiProperty({ description: 'Mobile / contact phone' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone: string;

  @ApiProperty({ description: 'Street / delivery address text' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  address: string;

  @ApiProperty({
    required: false,
    description: 'Building / unit / extra detail',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressDetails?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(45)
  postalCode?: string;

  @ApiProperty({ description: 'City id from /cities' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cityId: number;

  @ApiProperty({ required: false, description: 'Order / delivery notes' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
