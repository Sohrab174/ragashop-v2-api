import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { OrderStatus } from '../entities/order.entity';

export class UpdateOrderStatusDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty({ required: true, enum: OrderStatus })
  @IsNotEmpty()
  @IsIn(Object.values(OrderStatus))
  status: OrderStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  reasonRejected: string;
}
