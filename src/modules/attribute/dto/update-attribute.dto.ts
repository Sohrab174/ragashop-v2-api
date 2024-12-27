import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { Languages } from '../../../global.interfaces';
import { Type } from 'class-transformer';
import { AttributeTypes } from '../entities/attribute.entity';

class AttributeLocale {
  @ApiProperty()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: true, enum: Languages })
  @IsNotEmpty()
  @IsIn(Object.values(Languages))
  language: Languages;
}

export class UpdateAttributeDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty({ required: true, enum: AttributeTypes })
  @IsNotEmpty()
  @IsIn(Object.values(AttributeTypes))
  type: AttributeTypes;

  @ApiProperty({ required: false, type: [AttributeLocale] })
  @IsOptional()
  @Type(() => AttributeLocale)
  locales: AttributeLocale[];
}
