import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

export class IncredibleOfferImportExcelDto {
  @ApiProperty({ type: 'string', format: 'binary', required: true })
  file: any;

  @ApiProperty()
  @IsNotEmpty()
  fromDate: number;

  @ApiProperty()
  @IsNotEmpty()
  toDate: number;
}
