import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty } from 'class-validator';

export class AuthChangePasswordDto {
  @ApiProperty()
  @IsNotEmpty()
  @Transform(({ value }) => value.trim())
  oldPassword: string;

  @ApiProperty()
  @IsNotEmpty()
  @Transform(({ value }) => value.trim())
  newPassword: string;
}
