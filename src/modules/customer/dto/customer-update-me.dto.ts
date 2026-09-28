import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Self-service profile. Mobile is intentionally absent.
 * Authenticated customer id comes from the JWT, not this body.
 */
export class CustomerUpdateMeDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'نام الزامی است' })
  @MaxLength(45, { message: 'نام طولانی است' })
  firstName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'نام خانوادگی الزامی است' })
  @MaxLength(45, { message: 'نام خانوادگی طولانی است' })
  lastName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'آدرس طولانی است' })
  address?: string;
}
