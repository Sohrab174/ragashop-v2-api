import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { Languages } from '../../../global.interfaces';
import { Type } from 'class-transformer';

class AttributeValueLocale {
  @ApiProperty()
  @IsNotEmpty()
  value: string;

  @ApiProperty({ required: true, enum: Languages })
  @IsNotEmpty()
  @IsIn(Object.values(Languages))
  language: Languages;
}

export class UpdateAttributeValueDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty({ required: false })
  @IsOptional()
  extraValue: string;

  @ApiProperty({ required: false })
  @IsOptional()
  secondExtraValue: string;

  @ApiProperty({ required: false, type: [AttributeValueLocale] })
  @IsOptional()
  @Type(() => AttributeValueLocale)
  locales: AttributeValueLocale[];
}
