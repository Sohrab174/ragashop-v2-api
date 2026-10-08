import { UserService } from './user.service';
import { UserRoles, UserStatus } from './entities/user.entity';

describe('UserService employee.manage privilege boundary (ADMIN-RBAC-1)', () => {
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
          values: jest.fn((v) => {
            qb._values = v;
            return qb;
          }),
          execute: jest.fn(async () => {
            if (qb._values) {
              const created = {
                ...qb._values,
                id: 99,
                isDeleted: false,
                save: jest.fn(),
              };
              users.push(created);
              return { identifiers: [{ id: 99 }] };
            }
            return { affected: 1 };
          }),
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
      forbidden: jest.fn((msgs) => {
        throw new Error(msgs?.[0] || 'FORBIDDEN');
      }),
    };

    const capabilityService = {
      listEffectiveCodes: jest.fn(async () => []),
      replaceAll: jest.fn(async (_id, caps) => caps),
    };

    // After insert, findOne(newId) is used — seed that path
    const originalFindOne = userRepository.findOne;
    userRepository.findOne = jest.fn(async (arg) => {
      if (arg === 99) {
        return users.find((u) => u.id === 99) || null;
      }
      return originalFindOne(arg);
    });

    const svc = new UserService(
      userRepository,
      error as any,
      {} as any,
      capabilityService as any,
    );
    return { svc, error, users, userRepository };
  };

  const employeeActor = { id: 50, role: UserRoles.employee };
  const adminActor = { id: 1, role: UserRoles.admin };

  it('employee cannot create an admin account', async () => {
    const { svc } = makeService([]);
    await expect(
      svc.add(
        {
          firstName: 'Bad',
          lastName: 'Actor',
          password: 'x',
          role: UserRoles.admin,
          status: UserStatus.active,
        } as any,
        employeeActor,
      ),
    ).rejects.toThrow(/نقش مدیر/);
  });

  it('employee cannot promote another employee to admin', async () => {
    const target = {
      id: 10,
      role: UserRoles.employee,
      status: UserStatus.active,
      isDeleted: false,
      save: jest.fn(),
    };
    const { svc } = makeService([target]);
    await expect(
      svc.updateUser(10, { role: UserRoles.admin }, employeeActor),
    ).rejects.toThrow(/نقش مدیر/);
  });

  it('employee cannot edit an admin account', async () => {
    const admin = {
      id: 1,
      role: UserRoles.admin,
      status: UserStatus.active,
      isDeleted: false,
      save: jest.fn(),
    };
    const otherAdmin = {
      id: 2,
      role: UserRoles.admin,
      status: UserStatus.active,
      isDeleted: false,
    };
    const { svc } = makeService([admin, otherAdmin]);
    await expect(
      svc.updateUser(1, { firstName: 'Hacked' }, employeeActor),
    ).rejects.toThrow(/حساب مدیر/);
  });

  it('employee cannot deactivate an admin', async () => {
    const admin = {
      id: 1,
      role: UserRoles.admin,
      status: UserStatus.active,
      isDeleted: false,
      save: jest.fn(),
    };
    const otherAdmin = {
      id: 2,
      role: UserRoles.admin,
      status: UserStatus.active,
      isDeleted: false,
    };
    const { svc } = makeService([admin, otherAdmin]);
    await expect(
      svc.updateUser(1, { status: UserStatus.inactive }, employeeActor),
    ).rejects.toThrow(/حساب مدیر/);
  });

  it('employee cannot soft-delete an admin', async () => {
    const admin = {
      id: 1,
      role: UserRoles.admin,
      status: UserStatus.active,
      isDeleted: false,
    };
    const otherAdmin = {
      id: 2,
      role: UserRoles.admin,
      status: UserStatus.active,
      isDeleted: false,
    };
    const { svc } = makeService([admin, otherAdmin]);
    await expect(svc.deleteUser(1, 50, employeeActor)).rejects.toThrow(
      /حساب مدیر/,
    );
  });

  it('employee CAN create another employee', async () => {
    const { svc, users } = makeService([]);
    const created = await svc.add(
      {
        firstName: 'Ok',
        lastName: 'Emp',
        password: 'x',
        role: UserRoles.employee,
        status: UserStatus.active,
        email: 'ok@test.local',
      } as any,
      employeeActor,
    );
    expect(created.id).toBe(99);
    expect(users.find((u) => u.id === 99)?.role).toBe(UserRoles.employee);
  });

  it('employee CAN update another employee profile/status', async () => {
    const target = {
      id: 10,
      role: UserRoles.employee,
      status: UserStatus.active,
      isDeleted: false,
      firstName: 'Old',
      save: jest.fn(),
    };
    const { svc } = makeService([target]);
    await svc.updateUser(
      10,
      { firstName: 'New', status: UserStatus.inactive },
      employeeActor,
    );
    expect(target.firstName).toBe('New');
    expect(target.status).toBe(UserStatus.inactive);
    expect(target.save).toHaveBeenCalled();
  });

  it('employee CAN soft-delete another employee', async () => {
    const target = {
      id: 10,
      role: UserRoles.employee,
      status: UserStatus.active,
      isDeleted: false,
    };
    const { svc, userRepository } = makeService([target]);
    await svc.deleteUser(10, 50, employeeActor);
    expect(userRepository.createQueryBuilder).toHaveBeenCalled();
  });

  it('admin CAN still create/promote to admin when another admin exists', async () => {
    const a1 = {
      id: 1,
      role: UserRoles.admin,
      status: UserStatus.active,
      isDeleted: false,
      save: jest.fn(),
    };
    const emp = {
      id: 10,
      role: UserRoles.employee,
      status: UserStatus.active,
      isDeleted: false,
      save: jest.fn(),
    };
    const { svc } = makeService([a1, emp]);
    await svc.updateUser(10, { role: UserRoles.admin }, adminActor);
    expect(emp.role).toBe(UserRoles.admin);
  });

  it('last-active-admin protection still blocks admin demotion of the sole admin', async () => {
    const sole = {
      id: 1,
      role: UserRoles.admin,
      status: UserStatus.active,
      isDeleted: false,
      save: jest.fn(),
    };
    const { svc } = makeService([sole]);
    await expect(
      svc.updateUser(1, { role: UserRoles.employee }, adminActor),
    ).rejects.toThrow(/آخرین مدیر/);
  });
});
