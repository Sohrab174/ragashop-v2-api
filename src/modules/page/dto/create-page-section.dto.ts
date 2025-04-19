import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { PageSectionPosition } from '../entities/page-section.entity';

export class CreatePageSectionDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  pageId: number;

  @ApiProperty({ required: false, enum: PageSectionPosition })
  @IsNotEmpty()
  @IsIn(Object.values(PageSectionPosition))
  position: PageSectionPosition;

  @ApiProperty({ required: false })
  @IsOptional()
  primaryContent: string;

  @ApiProperty({ required: false })
  @IsOptional()
  link: string;

  @ApiProperty({ required: true })
  @IsNotEmpty()
  isPublished: boolean;
}
