import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, ValidateIf } from 'class-validator';
import { SortAction } from '../../../utils/sort';

export class CategorySortDto {
  @ApiProperty({ required: false })
  @IsNotEmpty()
  id: number;

  @ApiProperty({ required: true, enum: SortAction })
  @IsNotEmpty()
  @IsIn(Object.values(SortAction))
  @ValidateIf((p) => !p.alternate)
  action: SortAction;

  @ApiProperty({ required: true })
  @IsNotEmpty()
  @ValidateIf((p) => !p.action)
  alternate: number;
}
