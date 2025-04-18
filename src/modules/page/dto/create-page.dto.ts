import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional } from 'class-validator';

export class CreatePageDto {
  @ApiProperty()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  content: string;
}
