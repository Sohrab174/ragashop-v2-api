import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional } from 'class-validator';

export class UpdatePageDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  content: string;
}
