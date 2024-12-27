import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

export class DeleteCategoryDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  force: boolean;
}
