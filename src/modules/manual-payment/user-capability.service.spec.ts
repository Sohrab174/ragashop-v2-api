import { UserCapabilityService } from './user-capability.service';
import { UserCapabilityName } from '../auth/capability/capability.catalog';
import { UserRoles } from '../user/entities/user.entity';

describe('UserCapabilityService (ADMIN-RBAC-1)', () => {
  const makeService = (rows: Array<{ userId: number; capability: string }> = []) => {
    const store = [...rows];
    const capabilityRepository: any = {
      findOne: jest.fn(async ({ where }) =>
        store.find(
          (r) => r.userId === where.userId && r.capability === where.capability,
        ),
      ),
      find: jest.fn(async ({ where }) =>
        store
          .filter((r) => r.userId === where.userId)
          .map((r) => ({ ...r })),
      ),
      delete: jest.fn(async (where) => {
        for (let i = store.length - 1; i >= 0; i -= 1) {
          if (
            store[i].userId === where.userId &&
            (!where.capability || store[i].capability === where.capability)
          ) {
            store.splice(i, 1);
          }
        }
      }),
      createQueryBuilder: jest.fn(() => {
        const qb: any = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          values: jest.fn().mockReturnThis(),
          execute: jest.fn(async () => {
            // grant path
            return undefined;
          }),
          getOne: jest.fn(async () => {
            // used by userHasCapability IN query — simplified: match any stored
            return store[0] || null;
          }),
        };
        return qb;
      }),
      manager: {
        transaction: jest.fn(async (fn) => {
          const txStore: typeof store = [];
          const repo = {
            delete: jest.fn(async (where) => {
              for (let i = store.length - 1; i >= 0; i -= 1) {
                if (store[i].userId === where.userId) store.splice(i, 1);
              }
            }),
            insert: jest.fn(async (rowsToInsert) => {
              for (const row of rowsToInsert) {
                store.push({ userId: row.userId, capability: row.capability });
                txStore.push(row);
              }
            }),
          };
          await fn({ getRepository: () => repo });
          return txStore;
        }),
      },
      insert: jest.fn(),
    };

    const error = {
      forbidden: jest.fn(() => {
        throw new Error('FORBIDDEN');
      }),
      unprocessableEntity: jest.fn((msgs) => {
        throw new Error(msgs?.[0] || 'UNPROCESSABLE');
      }),
    };

    const svc = new UserCapabilityService(capabilityRepository, error as any);
    return { svc, store, capabilityRepository, error };
  };

  it('admin always has any capability', async () => {
    const { svc } = makeService();
    await expect(
      svc.userHasCapability(
        { id: 1, role: UserRoles.admin },
        UserCapabilityName.order_reject,
      ),
    ).resolves.toBe(true);
  });

  it('employee without rows is fail-closed', async () => {
    const { svc, capabilityRepository } = makeService([]);
    capabilityRepository.createQueryBuilder = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => null),
    }));
    await expect(
      svc.userHasCapability(
        { id: 9, role: UserRoles.employee },
        UserCapabilityName.order_read,
      ),
    ).resolves.toBe(false);
  });

  it('order.read does not satisfy order.reject', async () => {
    const { svc, capabilityRepository } = makeService([
      { userId: 9, capability: UserCapabilityName.order_read },
    ]);
    capabilityRepository.createQueryBuilder = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => null),
    }));
    await expect(
      svc.userHasCapability(
        { id: 9, role: UserRoles.employee },
        UserCapabilityName.order_reject,
      ),
    ).resolves.toBe(false);
  });

  it('support.manage satisfies support.read and support.reply', async () => {
    const { svc, capabilityRepository } = makeService([
      { userId: 9, capability: UserCapabilityName.support_manage },
    ]);
    capabilityRepository.createQueryBuilder = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => ({
        userId: 9,
        capability: UserCapabilityName.support_manage,
      })),
    }));
    await expect(
      svc.userHasCapability(
        { id: 9, role: UserRoles.employee },
        UserCapabilityName.support_read,
      ),
    ).resolves.toBe(true);
    await expect(
      svc.userHasCapability(
        { id: 9, role: UserRoles.employee },
        UserCapabilityName.support_reply,
      ),
    ).resolves.toBe(true);
  });

  it('replaceAll rejects unknown capability strings', async () => {
    const { svc } = makeService();
    await expect(svc.replaceAll(9, ['not.a.real.cap'])).rejects.toThrow(
      /دسترسی ناشناخته/,
    );
  });

  it('replaceAll is duplicate-safe and atomic', async () => {
    const { svc, store } = makeService([
      { userId: 9, capability: UserCapabilityName.order_read },
    ]);
    const result = await svc.replaceAll(9, [
      UserCapabilityName.order_read,
      UserCapabilityName.order_read,
      UserCapabilityName.order_prepare,
    ]);
    expect(result).toEqual([
      UserCapabilityName.order_prepare,
      UserCapabilityName.order_read,
    ]);
    expect(store.filter((r) => r.userId === 9).map((r) => r.capability).sort()).toEqual(
      result,
    );
  });

  it('listEffectiveCodes returns full catalog for admin', async () => {
    const { svc } = makeService();
    const codes = await svc.listEffectiveCodes({ id: 1, role: UserRoles.admin });
    expect(codes).toContain(UserCapabilityName.order_read);
    expect(codes).toContain(UserCapabilityName.employee_permissions);
    expect(codes.length).toBeGreaterThan(20);
  });
});
