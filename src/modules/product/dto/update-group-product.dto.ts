import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { ProductGender, ProductStatus } from '../entities/product.entity';

export class UpdateGroupProductDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  ids: number[];

  @ApiProperty({ required: false })
  @IsOptional()
  categoryId: number;

  @ApiProperty({ required: false, enum: ProductGender })
  @IsOptional()
  @IsIn(Object.values(ProductGender))
  gender: ProductGender;

  @ApiProperty({ required: false, enum: ProductStatus })
  @IsOptional()
  @IsIn(Object.values(ProductStatus))
  status: ProductStatus;
}
