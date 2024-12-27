import { IsIn, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AttributeTypes } from '../entities/attribute.entity';

export class CreateAttributeDto {
  @ApiProperty()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: true, enum: AttributeTypes })
  @IsNotEmpty()
  @IsIn(Object.values(AttributeTypes))
  type: AttributeTypes;
}
