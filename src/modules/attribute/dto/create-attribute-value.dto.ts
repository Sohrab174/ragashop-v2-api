import { IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAttributeValueDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  attributeId: number;

  @ApiProperty({ required: false })
  @IsOptional()
  extraValue: string;
}
