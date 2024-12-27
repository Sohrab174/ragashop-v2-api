import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty } from 'class-validator';
import { stringToBool } from '../../../utils';

export class CreateFileProductDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  productId: number;

  @ApiProperty({ required: true })
  @IsNotEmpty()
  title: string;

  @ApiProperty({ required: true })
  @Transform(({ value }) => stringToBool(value))
  @IsNotEmpty()
  allowDownload: boolean;

  @ApiProperty({ type: 'string', format: 'binary', required: true })
  file: any;
}
