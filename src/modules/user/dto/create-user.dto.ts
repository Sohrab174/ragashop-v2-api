import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  Validate,
} from 'class-validator';
import { UserStatus } from '../entities/user.entity';
import { IsNotExist } from '../../../utils/validators/is-not-exists.validator';

enum UserAllowRoles {
  admin = 'admin',
  employee = 'employee',
}

export class CreateUserDto {
  @ApiProperty()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ required: false, example: 'test1@example.com' })
  @IsOptional()
  @Transform(({ value }) => value.toLowerCase().trim())
  @Validate(IsNotExist, ['UserEntity'], {
    message: 'This email address has already been registered',
  })
  @IsEmail(
    {},
    {
      message: 'ایمیل وارد شده نامعتبر است',
    },
  )
  email?: string;

  @ApiProperty()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(({ value }) => value.toLowerCase().trim())
  @Validate(IsNotExist, ['UserEntity'], {
    message: 'This mobile has already been registered',
  })
  mobile?: string;

  @ApiProperty()
  @IsIn(Object.values(UserAllowRoles))
  @IsNotEmpty()
  role: UserAllowRoles;

  @ApiProperty()
  @IsIn(Object.values(UserStatus))
  @IsNotEmpty()
  status: UserStatus;
}
