import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
} from 'class-validator';

export class CartSelectionDto {
  @ApiProperty({ description: 'Attribute group id from PDP options' })
  @IsNotEmpty()
  attributeId: number;

  @ApiProperty({
    description: 'product_attribute_value.id (PDP option value id)',
  })
  @IsNotEmpty()
  valueId: number;
}

export class AddCartItemDto {
  @ApiProperty()
  @IsNotEmpty()
  productId: number;

  @ApiProperty({ example: 1 })
  @IsNotEmpty()
  quantity: number;

  @ApiPropertyOptional({ type: [CartSelectionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => CartSelectionDto)
  selections?: CartSelectionDto[];

  /** Ignored if present — frontend must not control price. */
  @ApiPropertyOptional()
  @IsOptional()
  unitPrice?: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  price?: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  subtotal?: unknown;
}

export class UpdateCartItemDto {
  @ApiProperty({ example: 2 })
  @IsNotEmpty()
  quantity: number;
}
