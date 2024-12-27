import { ApiProperty } from '@nestjs/swagger';

export class UploadCkeditorDto {
  @ApiProperty({ type: 'string', format: 'binary', required: true })
  upload: any;
}
