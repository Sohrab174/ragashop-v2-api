import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, ValidateIf } from 'class-validator';

export class UpdatePageSectionItemDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

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
