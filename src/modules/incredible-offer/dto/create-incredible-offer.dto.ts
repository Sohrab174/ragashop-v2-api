import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, ValidateNested } from 'class-validator';

class IncredibleOfferItem {
  @ApiProperty()
  @IsNotEmpty()
  productId: number;

  @ApiProperty()
  @IsOptional()
  productAttributeValueId?: number;

  @ApiProperty()
  @IsNotEmpty()
  discountedPrice: number;
}

export class CreateIncredibleOfferDto {
  @ApiProperty({ type: [IncredibleOfferItem] })
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => IncredibleOfferItem)
  products: IncredibleOfferItem[];

  @ApiProperty()
  @IsNotEmpty()
  fromDate: number;

  @ApiProperty()
  @IsNotEmpty()
  toDate: number;
}
