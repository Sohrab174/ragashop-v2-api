import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { prettyText } from '../../../utils';

export class CreateAddressDto {
  @ApiProperty({ required: true })
  @IsNotEmpty({ message: 'عنوان آدرس اجباری است' })
  @MaxLength(45, {
    message: 'عنوان آدرس وارد شده طولانی است، مثال: خانه یا محل کار',
  })
  @Transform(({ value }) => prettyText(value))
  title: string;

  @ApiProperty({ required: true })
  @IsNotEmpty()
  isDefault: boolean;

  @ApiProperty({ required: true })
  @IsNotEmpty({ message: 'آدرس اجباری است' })
  @Transform(({ value }) => prettyText(value))
  address: string;

  @ApiProperty({ required: true })
  @IsNotEmpty({ message: 'کدپستی اجباری است' })
  @Transform(({ value }) => prettyText(value))
  postalCode: string;

  @ApiProperty({ required: true })
  @IsNotEmpty({ message: 'پلاک و واحد اجباری است' })
  @Transform(({ value }) => prettyText(value))
  details: string;

  @ApiProperty({ required: true })
  @IsNotEmpty({ message: 'موقعیت مکانی روی نقشه اجباری است' })
  location: string;

  @ApiProperty({ required: false })
  @IsOptional()
  cityId: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(({ value }) => prettyText(value))
  phone: string;
}
