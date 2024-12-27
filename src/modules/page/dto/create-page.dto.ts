import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty } from 'class-validator';
import { Languages } from '../../../global.interfaces';

class CreatePageLocale {
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

export class CreatePageDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  code: string;

  @ApiProperty({ required: true, type: [CreatePageLocale] })
  @IsNotEmpty()
  @Type(() => CreatePageLocale)
  locales: CreatePageLocale[];
}
