import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { Languages } from '../../../global.interfaces';

class UpdatePageLocale {
  @ApiProperty()
  @IsNotEmpty()
  title: string;

  @ApiProperty()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ required: true, enum: Languages })
  @IsNotEmpty()
  @IsIn(Object.values(Languages))
  language: Languages;
}

export class UpdatePageDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty({ required: false })
  @IsOptional()
  code: string;

  @ApiProperty({ required: false, type: [UpdatePageLocale] })
  @IsOptional()
  @Type(() => UpdatePageLocale)
  locales: UpdatePageLocale[];
}
