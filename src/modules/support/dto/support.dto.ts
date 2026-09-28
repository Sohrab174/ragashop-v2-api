import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  SUPPORT_MESSAGE_MAX,
  SUPPORT_SUBJECT_MAX,
  SupportCategory,
  SupportStatus,
} from '../support.types';

export class CreateSupportRequestDto {
  @ApiProperty()
  @IsString()
  @IsIn(Object.values(SupportCategory))
  category: SupportCategory;

  @ApiProperty()
  @IsString()
  @MaxLength(SUPPORT_SUBJECT_MAX)
  subject: string;

  @ApiProperty()
  @IsString()
  @MaxLength(SUPPORT_MESSAGE_MAX)
  message: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orderId?: number;
}

export class CreateSupportMessageDto {
  @ApiProperty()
  @IsString()
  @MaxLength(SUPPORT_MESSAGE_MAX)
  message: string;
}

export class UpdateSupportStatusDto {
  @ApiProperty({ enum: SupportStatus })
  @IsString()
  @IsIn(Object.values(SupportStatus))
  status: SupportStatus;
}
