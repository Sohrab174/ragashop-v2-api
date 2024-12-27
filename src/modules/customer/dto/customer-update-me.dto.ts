import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

export class CustomerUpdateMeDto {
  @ApiProperty({ required: false })
  @IsOptional()
  firstName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  lastName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  address?: string;
}
