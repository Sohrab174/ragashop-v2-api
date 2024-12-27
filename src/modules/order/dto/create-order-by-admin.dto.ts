import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, ValidateNested } from 'class-validator';
import { OrderStatus } from '../entities/order.entity';

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

  @ApiProperty({ required: false })
  @IsOptional()
  price: number;
}

export class CreateOrderByAdminDto {
  @ApiProperty({ type: [ProductItem] })
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ProductItem)
  productItems: ProductItem[];

  @ApiProperty({ required: true })
  @IsNotEmpty()
  customerId: number;

  @ApiProperty({ required: true })
  @IsNotEmpty()
  address: string;

  @ApiProperty({ required: false })
  @IsOptional()
  description: string;

  @ApiProperty({ required: true, enum: OrderStatus })
  @IsNotEmpty()
  @IsIn(Object.values(OrderStatus))
  status: OrderStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  shipping: number;
}
