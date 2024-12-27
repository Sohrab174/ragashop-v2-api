import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  Validate,
} from 'class-validator';
import { IsNotExist } from 'src/utils/validators/is-not-exists.validator';
import { UserStatus } from '../entities/user.entity';

enum UserAllowRoles {
  admin = 'admin',
  employee = 'employee',
}

export class UpdateUserDto {
  @ApiProperty()
  @IsNotEmpty()
  id: number;

  @ApiProperty({ required: false })
  @IsOptional()
  companyId: number;

  @ApiProperty({ required: false, example: '' })
  @IsOptional()
  firstName?: string;

  @ApiProperty({ required: false, example: '' })
  @IsOptional()
  lastName?: string;

  @ApiProperty({ required: false, example: 'test1@example.com' })
  @IsOptional()
  @Transform(({ value }) => value.toLowerCase().trim())
  @Validate(IsNotExist, ['UserEntity'], {
    message: 'This email address has already been registered',
  })
  @IsEmail(
    {},
    {
      message: 'The email is invalid',
    },
  )
  email?: string;

  @ApiProperty({ required: false, example: '' })
  @IsOptional()
  password?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(({ value }) => value.toLowerCase().trim())
  @Validate(IsNotExist, ['UserEntity'], {
    message: 'This mobile has already been registered',
  })
  mobile?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsIn(Object.values(UserAllowRoles))
  role: UserAllowRoles;

  @ApiProperty({ required: false, example: '' })
  @IsOptional()
  @IsIn(Object.values(UserStatus))
  status?: UserStatus;
}
