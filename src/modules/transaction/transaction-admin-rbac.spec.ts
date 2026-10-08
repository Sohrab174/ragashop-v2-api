import { GUARDS_METADATA } from '@nestjs/common/constants';
import { TransactionController } from './transaction.controller';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { RolesGuard } from '../auth/role/role.guard';
import { UserRoles } from '../user/entities/user.entity';

describe('TransactionController — Admin-only list (P1 F4)', () => {
  const proto = TransactionController.prototype as any;
  const rolesOf = (method: string) =>
    Reflect.getMetadata('roles', proto[method]);
  const guardsOf = (method: string) =>
    Reflect.getMetadata(GUARDS_METADATA, proto[method]) || [];

  it('GET /transactions/admin is Admin-only', () => {
    expect(rolesOf('getAllForAdmin')).toEqual([UserRoles.admin]);
    expect(rolesOf('getAllForAdmin')).not.toContain(UserRoles.employee);
    const guards = guardsOf('getAllForAdmin');
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });
});
