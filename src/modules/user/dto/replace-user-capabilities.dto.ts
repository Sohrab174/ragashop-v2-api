import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class ReplaceUserCapabilitiesDto {
  @ApiProperty({
    type: [String],
    description: 'Full replacement set of capability codes from the canonical catalog',
  })
  @IsArray()
  @IsString({ each: true })
  capabilities: string[];
}
