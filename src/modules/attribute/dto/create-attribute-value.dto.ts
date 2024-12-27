import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { Languages } from '../../../global.interfaces';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class AttributeLocale {
  @ApiProperty()
  @IsNotEmpty()
  value: string;

  @ApiProperty({ required: true, enum: Languages })
  @IsNotEmpty()
  @IsIn(Object.values(Languages))
  language: Languages;
}

export class CreateAttributeValueDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  attributeId: number;

  @ApiProperty({ required: false })
  @IsOptional()
  extraValue: string;

  @ApiProperty({ required: false })
  @IsOptional()
  secondExtraValue: string;

  @ApiProperty({ required: true, type: [AttributeLocale] })
  @IsNotEmpty()
  @Type(() => AttributeLocale)
  locales: AttributeLocale[];
}
