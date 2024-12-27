import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { Languages } from '../../../global.interfaces';
import { SliderPositions } from '../entities/slider.entity';

export class UpdateSliderDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty({ type: 'string', format: 'binary', required: false })
  file: any;

  @ApiProperty({ required: true, enum: SliderPositions })
  @IsNotEmpty()
  @IsIn(Object.values(SliderPositions))
  position: SliderPositions;

  @ApiProperty({ required: false })
  @IsOptional()
  title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  description: string;

  @ApiProperty({ required: false })
  @IsOptional()
  url: string;

  @ApiProperty({ required: false, enum: ['', ...Object.values(Languages)] })
  @IsOptional()
  @IsIn(['', ...Object.values(Languages)])
  language: Languages;
}
