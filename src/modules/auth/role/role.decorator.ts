import { SetMetadata } from '@nestjs/common';
import { UserRoles } from '../../user/entities/user.entity';

export const Roles = (...roles: UserRoles[]) => SetMetadata('roles', roles);
