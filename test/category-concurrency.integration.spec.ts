import { createConnection, Connection } from 'typeorm';
import {
  CategoryEntity,
  CategoryStatus,
} from '../src/modules/category/entities/category.entity';
import { CategoryHierarchyLockService } from '../src/modules/category/category-hierarchy-lock.service';
import { validateCategoryParentAssignment } from '../src/modules/category/category-hierarchy.validation';

const LOCAL_HOST = '127.0.0.1';
const LOCAL_DB = 'ragashop_local';

describe('Category hierarchy concurrency (LOCAL DB)', () => {
  let connection: Connection;
  let dbAvailable = false;
  let skipReason = '';
  const createdCategoryIds: number[] = [];

  beforeAll(async () => {
    try {
      connection = await createConnection({
        type: 'mysql',
        host: LOCAL_HOST,
        port: 3306,
        username: 'root',
        password: '',
        database: LOCAL_DB,
        entities: [`${__dirname}/../src/**/*.entity{.ts,.js}`],
      });
      dbAvailable = true;
    } catch (err) {
      skipReason = err?.message || 'connection failed';
    }
  }, 120000);

  afterAll(async () => {
    if (connection?.isConnected) {
      if (createdCategoryIds.length) {
        await connection.query(
          `UPDATE category SET parentId = NULL WHERE id IN (${createdCategoryIds.join(
            ',',
          )})`,
        );
        await connection.query(
          `DELETE FROM category WHERE id IN (${createdCategoryIds.join(',')})`,
        );
      }
      await connection.close();
    }
  });

  function requireDb() {
    if (!dbAvailable) throw new Error(`LOCAL DB unavailable: ${skipReason}`);
  }

  async function createCategory(name: string, parentId: number | null = 2) {
    const repo = connection.getRepository(CategoryEntity);
    const row = await repo.save(
      repo.create({
        name,
        status: CategoryStatus.active,
        parentId,
        displayOrder: 1,
        createdAt: new Date(),
      }),
    );
    createdCategoryIds.push(row.id);
    return row;
  }

  it('prevents simultaneous A→B and B→A parent assignment (2-node cycle)', async () => {
    requireDb();
    const lockService = new CategoryHierarchyLockService(connection);
    const repo = connection.getRepository(CategoryEntity);
    const catA = await createCategory(`CycleA ${Date.now()}`);
    const catB = await createCategory(`CycleB ${Date.now()}`);

    const tryAssignParent = async (childId: number, parentId: number) => {
      try {
        return await lockService.withHierarchyMutationLock(
          childId,
          parentId,
          async () => {
            await validateCategoryParentAssignment(repo, childId, parentId);
            await repo.update(childId, { parentId });
            return true;
          },
        );
      } catch {
        return false;
      }
    };

    const [first, second] = await Promise.all([
      tryAssignParent(catA.id, catB.id),
      tryAssignParent(catB.id, catA.id),
    ]);

    expect(first && second).toBe(false);

    const reloadedA = await repo.findOne(catA.id);
    const reloadedB = await repo.findOne(catB.id);
    const formsCycle =
      reloadedA.parentId === catB.id && reloadedB.parentId === catA.id;
    expect(formsCycle).toBe(false);
  });

  it('prevents simultaneous 3-node cycle A→B, B→C, C→A under concurrent locks', async () => {
    requireDb();
    const lockService = new CategoryHierarchyLockService(connection);
    const repo = connection.getRepository(CategoryEntity);
    const catA = await createCategory(`TriA ${Date.now()}`);
    const catB = await createCategory(`TriB ${Date.now()}`);
    const catC = await createCategory(`TriC ${Date.now()}`);

    const tryAssignParent = async (childId: number, parentId: number) => {
      try {
        return await lockService.withHierarchyMutationLock(
          childId,
          parentId,
          async () => {
            await validateCategoryParentAssignment(repo, childId, parentId);
            await repo.update(childId, { parentId });
            return true;
          },
        );
      } catch {
        return false;
      }
    };

    const results = await Promise.all([
      tryAssignParent(catA.id, catB.id),
      tryAssignParent(catB.id, catC.id),
      tryAssignParent(catC.id, catA.id),
    ]);

    expect(results.filter(Boolean).length).toBeLessThanOrEqual(2);
    const reloaded = await Promise.all([
      repo.findOne(catA.id),
      repo.findOne(catB.id),
      repo.findOne(catC.id),
    ]);
    const parentMap = new Map(reloaded.map((c) => [c!.id, c!.parentId]));
    const hasCycle =
      parentMap.get(catA.id) === catB.id &&
      parentMap.get(catB.id) === catC.id &&
      parentMap.get(catC.id) === catA.id;
    expect(hasCycle).toBe(false);
  });

  it('releases category lock after failed mutation so next operation can proceed', async () => {
    requireDb();
    const lockService = new CategoryHierarchyLockService(connection);
    const repo = connection.getRepository(CategoryEntity);
    const catA = await createCategory(`LockRel ${Date.now()}`);
    const catB = await createCategory(`LockRelB ${Date.now()}`);

    const failAssign = async () => {
      try {
        await lockService.withHierarchyMutationLock(
          catA.id,
          catB.id,
          async () => {
            await validateCategoryParentAssignment(repo, catA.id, catA.id);
            await repo.update(catA.id, { parentId: catA.id });
          },
        );
        return true;
      } catch {
        return false;
      }
    };

    expect(await failAssign()).toBe(false);

    const ok = await lockService.withHierarchyMutationLock(
      catA.id,
      catB.id,
      async () => {
        await validateCategoryParentAssignment(repo, catA.id, catB.id);
        await repo.update(catA.id, { parentId: catB.id });
        return true;
      },
    );
    expect(ok).toBe(true);
  });
});
