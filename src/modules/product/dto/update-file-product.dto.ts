import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';
import { stringToBool } from '../../../utils';
import { Transform } from 'class-transformer';

export class UpdateFileProductDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty({ required: true })
  @IsNotEmpty()
  title: string;

  @ApiProperty({ required: true })
  @Transform(({ value }) => stringToBool(value))
  @IsNotEmpty()
  allowDownload: boolean;
}
