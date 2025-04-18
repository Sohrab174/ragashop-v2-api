import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional } from 'class-validator';

export class UpdatePageSectionDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty({ required: false })
  @IsOptional()
  primaryContent: string;

  @ApiProperty({ required: false })
  @IsOptional()
  isPublished: boolean;
}
