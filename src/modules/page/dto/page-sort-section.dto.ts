import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, ValidateIf } from 'class-validator';
import { SortAction } from '../../../utils/sort';

export class PageSectionSortDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty({ required: true, enum: SortAction })
  @IsNotEmpty()
  @IsIn(Object.values(SortAction))
  @ValidateIf((p) => !p.alternate)
  action: SortAction;
}
