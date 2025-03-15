import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, ValidateNested } from 'class-validator';
import { convertPersianToEnglishDigit } from '../../../utils/persianNumbers';

export class ProductItem {
  @ApiProperty()
  @IsNotEmpty()
  productId: number;

  @ApiProperty()
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({ required: false })
  @IsOptional()
  productAttributeValueId: number;
}

export class CreateOrderDto {
  @ApiProperty({ type: [ProductItem] })
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ProductItem)
  productItems: ProductItem[];

  @ApiProperty({ required: false })
  @IsNotEmpty()
  addressId: number;

  @ApiProperty({ required: false })
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ required: false })
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ required: false })
  @IsOptional()
  description: string;

  @ApiProperty({ example: 'ABC123', required: false })
  @Transform(({ value }) =>
    value ? convertPersianToEnglishDigit(value.trim().toUpperCase()) : null,
  )
  @IsOptional()
  discountCouponCode: string;
}
