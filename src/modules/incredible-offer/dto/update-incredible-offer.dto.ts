import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

export class UpdateIncredibleOfferDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty()
  @IsNotEmpty()
  discountedPrice: number;

  @ApiProperty()
  @IsNotEmpty()
  fromDate: string;

  @ApiProperty()
  @IsNotEmpty()
  toDate: string;
}
