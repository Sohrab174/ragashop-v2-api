import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

export class UpdateSettingDto {
  @ApiProperty({ required: false })
  @IsOptional()
  phone: string;

  @ApiProperty({ required: false })
  @IsOptional()
  email: string;

  @ApiProperty({ required: false })
  @IsOptional()
  address: string;

  @ApiProperty({ required: false })
  @IsOptional()
  location: string;

  @ApiProperty({ required: false })
  @IsOptional()
  instagram: string;

  @ApiProperty({ required: false })
  @IsOptional()
  linkedin: string;

  @ApiProperty({ required: false })
  @IsOptional()
  telegram: string;

  @ApiProperty({ required: false })
  @IsOptional()
  twitter: string;

  @ApiProperty({ required: false })
  @IsOptional()
  facebook: string;

  @ApiProperty({ required: false })
  @IsOptional()
  whatsapp: string;

  @ApiProperty({ required: false })
  @IsOptional()
  shippingCost: number;

  @ApiProperty({ required: false })
  @IsOptional()
  vat: number;

  @ApiProperty({ required: false })
  @IsOptional()
  noticeBeforeOrdering: string;

  @ApiProperty({ required: false })
  @IsOptional()
  minDeliveryDay: number;

  @ApiProperty({ required: false })
  @IsOptional()
  maxDeliveryDay: number;
}
