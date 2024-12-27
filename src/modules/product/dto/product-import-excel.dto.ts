import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional } from 'class-validator';
import { jsonStringToObject } from '../../../utils';

class photo {
  @ApiProperty()
  @IsNotEmpty()
  galleryId: number;

  @ApiProperty()
  @IsNotEmpty()
  originalPhotoName: string;

  // not used
  @ApiProperty()
  @IsOptional()
  isAdded: boolean;
}

export class ProductImportExcelDto {
  @ApiProperty({ type: 'string', format: 'binary', required: true })
  file: any;

  @ApiProperty({ required: true, type: 'string' })
  @Transform(({ value }) => jsonStringToObject(value))
  @IsNotEmpty()
  photos: photo[];
}
