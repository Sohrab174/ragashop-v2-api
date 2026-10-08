import { GUARDS_METADATA } from '@nestjs/common/constants';
import { GatewayController } from './gateway.controller';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { RolesGuard } from '../auth/role/role.guard';
import { UserRoles } from '../user/entities/user.entity';
import { CAPABILITIES_KEY } from '../auth/capability/capability.decorator';

describe('GatewayController — Admin-only RBAC (P1 F4)', () => {
  const proto = GatewayController.prototype as any;
  const rolesOf = (method: string) =>
    Reflect.getMetadata('roles', proto[method]);
  const guardsOf = (method: string) =>
    Reflect.getMetadata(GUARDS_METADATA, proto[method]) || [];
  const capsOf = (method: string) =>
    Reflect.getMetadata(CAPABILITIES_KEY, proto[method]);

  it.each([
    'getAvailabilities',
    'getById',
    'getAllForAdmin',
    'add',
    'sort',
    'update',
    'delete',
  ])('%s is Admin-only (employee role removed)', (method) => {
    expect(rolesOf(method)).toEqual([UserRoles.admin]);
    expect(rolesOf(method)).not.toContain(UserRoles.employee);
    const guards = guardsOf(method);
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
    // Admin-only via RolesGuard; no broad employee capability grant.
    expect(capsOf(method)).toBeUndefined();
  });

  it('public GET /gateways stays open', () => {
    expect(rolesOf('getAll')).toBeUndefined();
    expect(guardsOf('getAll')).toEqual([]);
  });
});
