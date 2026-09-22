import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional } from 'class-validator';

export class OrderProductItemQuantityBase {
  @ApiProperty()
  @IsNotEmpty()
  productId: number;

  @ApiProperty({ minimum: 1 })
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({ required: false })
  @IsOptional()
  productAttributeValueId?: number;
}
