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

  @ApiProperty({ required: false })
  @IsOptional()
  purchaseCost: number;

  @ApiProperty({ required: false })
  @IsOptional()
  landedUnitCost: number;

  @ApiProperty({ required: false, enum: ['USD', 'TRY', 'IRT'] })
  @IsOptional()
  costCurrency: 'USD' | 'TRY' | 'IRT';

  @ApiProperty({
    required: false,
    enum: ['manual_admin', 'import_manual', 'calculated', 'unknown_legacy'],
  })
  @IsOptional()
  costSource:
    | 'manual_admin'
    | 'import_manual'
    | 'calculated'
    | 'unknown_legacy';
}
