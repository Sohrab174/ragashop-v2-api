import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, ValidateIf } from 'class-validator';
import { ProductStatus, ProductType } from '../entities/product.entity';

export class UpdateProductDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsOptional()
  description: string;

  @ApiProperty()
  @IsOptional()
  shortDescription: string;

  @ApiProperty({ required: false })
  @IsOptional()
  categoryId: number;

  @ApiProperty({ required: false })
  @IsOptional()
  number: string;

  @ApiProperty({ required: false })
  @IsOptional()
  price: number;

  @ApiProperty({ required: false })
  @IsOptional()
  quantity: number;

  @ApiProperty({ required: false })
  @IsOptional()
  discountedPrice: number;

  @ApiProperty({ required: false })
  @IsOptional()
  showPrice: boolean;

  @ApiProperty({ required: false, enum: ProductStatus })
  @IsOptional()
  @IsIn(Object.values(ProductStatus))
  status: ProductStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  coverId: number;

  @ApiProperty({ required: true })
  @ValidateIf((p) => p.type === ProductType.service)
  @IsNotEmpty()
  serviceId: number;

  @ApiProperty({ required: true })
  @ValidateIf((p) => p.type === ProductType.service)
  @IsNotEmpty()
  serviceToken: string;
}
