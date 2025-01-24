import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional } from 'class-validator';

export class UpdateAttributeValueDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty({ required: false })
  @IsOptional()
  extraValue: string;
}
