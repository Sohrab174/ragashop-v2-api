import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import {
  PageSectionDisplayMode,
  PageSectionProductGender,
} from '../entities/page-section.entity';

export class UpdatePageSectionDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty({ required: false })
  @IsOptional()
  primaryContent: string;

  @ApiProperty({ required: false })
  @IsOptional()
  link: string;

  @ApiProperty({ required: false, enum: PageSectionDisplayMode })
  @IsOptional()
  @IsIn(Object.values(PageSectionDisplayMode))
  displayMode: PageSectionDisplayMode;

  @ApiProperty({ required: false })
  @IsOptional()
  selectedTags: any;

  @ApiProperty({ required: false })
  @IsOptional()
  selectedCategoryId: any;

  @ApiProperty({ required: false, enum: PageSectionProductGender })
  @IsOptional()
  @IsIn(Object.values(PageSectionProductGender))
  productGender: PageSectionProductGender;

  @ApiProperty({ required: false })
  @IsOptional()
  isPublished: boolean;
}
