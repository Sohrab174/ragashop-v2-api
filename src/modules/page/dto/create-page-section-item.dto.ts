import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional } from 'class-validator';

export class CreatePageSectionItemDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  sectionId: number;

  @ApiProperty({ required: false })
  @IsOptional()
  primaryContent: string;

  @ApiProperty({ required: false })
  @IsOptional()
  secondaryContent: string;

  @ApiProperty({ required: false })
  @IsOptional()
  buttonContent: string;

  @ApiProperty({ required: false })
  @IsOptional()
  link: string;

  @ApiProperty({ required: false })
  @IsOptional()
  linkType: string;

  @ApiProperty({ required: false })
  @IsOptional()
  type: string;

  @ApiProperty({ required: false })
  @IsOptional()
  productId: number;

  @ApiProperty({ required: false })
  @IsOptional()
  categoryId: number;

  @ApiProperty({ required: false })
  @IsOptional()
  brandId: number;

  @ApiProperty({ required: false })
  @IsOptional()
  pageId: number;
}
