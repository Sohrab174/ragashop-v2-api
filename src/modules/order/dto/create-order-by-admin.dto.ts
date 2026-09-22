import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, ValidateNested } from 'class-validator';
import { OrderStatus } from '../entities/order.entity';
import { OrderProductItemQuantityBase } from '../utils/order-item.validators';

export class ProductItem extends OrderProductItemQuantityBase {
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
