import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { Languages } from '../../../global.interfaces';
import { SliderPositions } from '../entities/slider.entity';

export class CreateSliderDto {
  @ApiProperty({ type: 'string', format: 'binary', required: true })
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
