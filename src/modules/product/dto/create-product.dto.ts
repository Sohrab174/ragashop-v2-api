import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, ValidateNested } from 'class-validator';
import { ProductStatus } from '../entities/product.entity';
import { Type } from 'class-transformer';

class ProductDescription {
  @ApiProperty({ required: false })
  @IsOptional()
  id: number;

  @ApiProperty({ required: true })
  @IsNotEmpty({ message: 'متن توضیح را وارد نمایید.' })
  content: string;
}

export class CreateProductDto {
  @ApiProperty()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsOptional()
  description: string;

  @ApiProperty({ type: [ProductDescription] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ProductDescription)
  descriptions: ProductDescription[];

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

  @ApiProperty({ required: true, enum: ProductStatus })
  @IsNotEmpty()
  @IsIn(Object.values(ProductStatus))
  status: ProductStatus;
}
