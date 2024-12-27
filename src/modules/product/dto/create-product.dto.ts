import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, ValidateIf } from 'class-validator';
import { ProductStatus, ProductType } from '../entities/product.entity';

export class CreateProductDto {
  @ApiProperty()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsOptional()
  shortDescription: string;

  @ApiProperty()
  @IsOptional()
  description: string;

  @ApiProperty({ required: true })
  @IsNotEmpty()
  categoryId: number;

  @ApiProperty({ required: false })
  @IsOptional()
  number: string;

  @ApiProperty({ required: false })
  @IsOptional()
  quantity: number;

  @ApiProperty({ required: false })
  @IsOptional()
  price: number;

  @ApiProperty({ required: true })
  @IsOptional()
  discountedPrice: number;

  @ApiProperty({ required: true })
  @IsNotEmpty()
  showPrice: boolean;

  @ApiProperty({ required: true, enum: ProductStatus })
  @IsNotEmpty()
  @IsIn(Object.values(ProductStatus))
  status: ProductStatus;

  @ApiProperty({ required: true, enum: ProductType })
  @IsNotEmpty()
  @IsIn(Object.values(ProductType))
  type: ProductType;

  @ApiProperty({ required: true })
  @ValidateIf((p) => p.type === ProductType.service)
  @IsNotEmpty()
  serviceId: number;

  @ApiProperty({ required: false })
  @IsOptional()
  serviceToken: string;
}
