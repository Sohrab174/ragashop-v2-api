import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional } from 'class-validator';

export class CreateUpdateProductAttrValueDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  productId: number;

  @ApiProperty({ required: true })
  @IsNotEmpty()
  attributeValueId: number;

  @ApiProperty({ required: false })
  @IsOptional()
  number: string;

  @ApiProperty({ required: false })
  @IsOptional()
  quantity: number;

  @ApiProperty({ required: false })
  @IsOptional()
  price: number;

  @ApiProperty({ required: false })
  @IsOptional()
  discountedPrice: number;
}
