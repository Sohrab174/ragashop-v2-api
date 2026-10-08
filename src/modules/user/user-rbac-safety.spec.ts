import { UserService } from './user.service';
import { UserRoles, UserStatus } from './entities/user.entity';

describe('UserService owner safety (ADMIN-RBAC-1)', () => {
  const makeService = (users: any[]) => {
    const userRepository: any = {
      findOne: jest.fn(async (arg) => {
        if (typeof arg === 'number') {
          return users.find((u) => u.id === arg) || null;
        }
        if (arg?.id) return users.find((u) => u.id === arg.id) || null;
        return null;
      }),
      createQueryBuilder: jest.fn(() => {
        const qb: any = {
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          take: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          getManyAndCount: jest.fn(async () => [
            users.filter((u) => !u.isDeleted),
            users.filter((u) => !u.isDeleted).length,
          ]),
          getOne: jest.fn(),
          getCount: jest.fn(async () =>
            users.filter(
              (u) =>
                u.role === UserRoles.admin &&
                u.status === UserStatus.active &&
                !u.isDeleted,
            ).length,
          ),
          insert: jest.fn().mockReturnThis(),
          values: jest.fn().mockReturnThis(),
          execute: jest.fn(),
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
        };
        return qb;
      }),
    };

    const error = {
      methodNotAllowed: jest.fn((msgs) => {
        throw new Error(msgs?.[0] || 'METHOD_NOT_ALLOWED');
      }),
      unprocessableEntity: jest.fn((msgs) => {
        throw new Error(msgs?.[0] || 'UNPROCESSABLE');
      }),
    };

    const capabilityService = {
      listEffectiveCodes: jest.fn(async () => []),
      replaceAll: jest.fn(async (_id, caps) => caps),
    };

    const svc = new UserService(
      userRepository,
      error as any,
      {} as any,
      capabilityService as any,
    );
    return { svc, error, users };
  };

  it('cannot deactivate the last active admin', async () => {
    const admin = {
      id: 1,
      role: UserRoles.admin,
      status: UserStatus.active,
      isDeleted: false,
      save: jest.fn(),
    };
    const { svc } = makeService([admin]);
    await expect(
      svc.updateUser(1, { status: UserStatus.inactive }),
    ).rejects.toThrow(/آخرین مدیر/);
  });

  it('cannot soft-delete the last active admin', async () => {
    const admin = {
      id: 1,
      role: UserRoles.admin,
      status: UserStatus.active,
      isDeleted: false,
    };
    const { svc } = makeService([admin]);
    await expect(svc.deleteUser(1, 99)).rejects.toThrow(/آخرین مدیر/);
  });

  it('cannot demote the last active admin', async () => {
    const admin = {
      id: 1,
      role: UserRoles.admin,
      status: UserStatus.active,
      isDeleted: false,
      save: jest.fn(),
    };
    const { svc } = makeService([admin]);
    await expect(
      svc.updateUser(1, { role: UserRoles.employee }),
    ).rejects.toThrow(/آخرین مدیر/);
  });

  it('allows demoting an admin when another active admin exists', async () => {
    const a1 = {
      id: 1,
      role: UserRoles.admin,
      status: UserStatus.active,
      isDeleted: false,
      save: jest.fn(),
    };
    const a2 = {
      id: 2,
      role: UserRoles.admin,
      status: UserStatus.active,
      isDeleted: false,
    };
    const { svc } = makeService([a1, a2]);
    await svc.updateUser(1, { role: UserRoles.employee });
    expect(a1.role).toBe(UserRoles.employee);
    expect(a1.save).toHaveBeenCalled();
  });

  it('refuses capability assignment on admin users', async () => {
    const admin = {
      id: 1,
      role: UserRoles.admin,
      status: UserStatus.active,
      isDeleted: false,
    };
    const { svc } = makeService([admin]);
    await expect(svc.replaceCapabilitiesForAdmin(1, [])).rejects.toThrow(
      /دسترسی مدیر کامل/,
    );
  });
});
