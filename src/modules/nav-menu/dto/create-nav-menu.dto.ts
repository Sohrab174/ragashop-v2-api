import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { NavMenuPosition } from '../entities/nav-menu.entity';

export class CreateNavMenuDto {
  @ApiProperty()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ required: true, enum: NavMenuPosition })
  @IsNotEmpty()
  @IsIn(Object.values(NavMenuPosition))
  position: NavMenuPosition;

  @ApiProperty({ required: false })
  @IsOptional()
  pageId: number;

  @ApiProperty({ required: false })
  @IsOptional()
  categoryId: number;

  @ApiProperty({ required: false })
  @IsOptional()
  internalLink: string;

  @ApiProperty({ required: false })
  @IsOptional()
  externalLink: string;
}
