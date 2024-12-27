import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional } from 'class-validator';
import { stringToBool } from '../../../utils';

export class CreateProductGalleryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  productId: number;

  @ApiProperty({ required: false })
  @Transform(({ value }) => stringToBool(value))
  @IsOptional()
  isCover: boolean;

  @ApiProperty({ type: 'string', format: 'binary', required: true })
  file: any;
}
