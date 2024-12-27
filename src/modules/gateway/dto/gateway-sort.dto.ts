import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty } from 'class-validator';
import { SortAction } from '../../../utils/sort';

export class GatewaySortDto {
  @ApiProperty({ required: false })
  @IsNotEmpty()
  id: number;

  @ApiProperty({ required: false, enum: SortAction })
  @IsNotEmpty()
  @IsIn(Object.values(SortAction))
  action: SortAction;
}
