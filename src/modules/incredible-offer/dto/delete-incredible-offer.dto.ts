import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

export class DeleteIncredibleOfferDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  ids: number[];
}
