import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty } from 'class-validator';
import { AttributeTypes } from '../entities/attribute.entity';

export class UpdateAttributeDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty({ required: true, enum: AttributeTypes })
  @IsNotEmpty()
  @IsIn(Object.values(AttributeTypes))
  type: AttributeTypes;
}
