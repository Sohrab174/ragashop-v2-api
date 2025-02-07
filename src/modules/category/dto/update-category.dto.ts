import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { CategoryStatus } from '../entities/category.entity';

export class UpdateCategoryDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  parentId: number;

  @ApiProperty({ required: true, enum: CategoryStatus })
  @IsNotEmpty()
  @IsIn(Object.values(CategoryStatus))
  status: CategoryStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  isSelection: boolean;
}
