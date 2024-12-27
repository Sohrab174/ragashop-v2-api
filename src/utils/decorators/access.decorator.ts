import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const Access = createParamDecorator(
  (permissionType: string, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    return user.role.rolePermissions.some(
      (rp) => rp.permission.type === permissionType,
    );
  },
);
