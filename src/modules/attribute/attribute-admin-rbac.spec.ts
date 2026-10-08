import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AttributeController } from './attribute.controller';
import { CAPABILITIES_KEY } from '../auth/capability/capability.decorator';
import { UserCapabilityName } from '../auth/capability/capability.catalog';
import { PermissionsGuard } from '../auth/capability/permissions.guard';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { RolesGuard } from '../auth/role/role.guard';
import { UserRoles } from '../user/entities/user.entity';

describe('AttributeController — Admin RBAC (P1 F4)', () => {
  const proto = AttributeController.prototype as any;
  const capsOf = (method: string) =>
    Reflect.getMetadata(CAPABILITIES_KEY, proto[method]);
  const guardsOf = (method: string) =>
    Reflect.getMetadata(GUARDS_METADATA, proto[method]) || [];
  const rolesOf = (method: string) =>
    Reflect.getMetadata('roles', proto[method]);

  it.each([
    ['getAllValuesForAdmin', UserCapabilityName.product_read],
    ['getAllForAdmin', UserCapabilityName.product_read],
    ['getByIdForAdmin', UserCapabilityName.product_read],
  ])('%s requires %s', (method, cap) => {
    expect(capsOf(method)).toEqual([cap]);
    const guards = guardsOf(method);
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
    expect(guards).toContain(PermissionsGuard);
    expect(rolesOf(method)).toEqual([UserRoles.admin, UserRoles.employee]);
  });

  it.each([
    ['addValue', UserCapabilityName.product_write],
    ['add', UserCapabilityName.product_write],
    ['updateValues', UserCapabilityName.product_write],
    ['update', UserCapabilityName.product_write],
    ['deleteValue', UserCapabilityName.product_write],
    ['delete', UserCapabilityName.product_write],
  ])('%s requires %s', (method, cap) => {
    expect(capsOf(method)).toEqual([cap]);
    const guards = guardsOf(method);
    expect(guards).toContain(PermissionsGuard);
    expect(rolesOf(method)).toEqual([UserRoles.admin, UserRoles.employee]);
  });

  it('public filter route stays unguarded by PermissionsGuard', () => {
    expect(capsOf('getAttributesForFilter')).toBeUndefined();
    expect(guardsOf('getAttributesForFilter')).not.toContain(PermissionsGuard);
  });
});
