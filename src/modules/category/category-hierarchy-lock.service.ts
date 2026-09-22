import { Injectable } from '@nestjs/common';
import { Connection } from 'typeorm';
import { withMysqlNamedLock } from '../../utils/named-lock.util';

@Injectable()
export class CategoryHierarchyLockService {
  constructor(private readonly connection: Connection) {}

  private hierarchyLockName(categoryId: number): string {
    return `ragashop_category_hierarchy_${categoryId}`;
  }

  /**
   * Acquires hierarchy locks in deterministic ascending id order to prevent inversion.
   */
  async withHierarchyMutationLock<T>(
    categoryId: number,
    parentId: number | null | undefined,
    fn: () => Promise<T>,
    timeoutSeconds = 10,
  ): Promise<T> {
    const lockIds = [categoryId, parentId].filter(
      (id): id is number => id != null && id > 0,
    );
    const uniqueSorted = [...new Set(lockIds)].sort((a, b) => a - b);

    const acquire = async (index: number): Promise<T> => {
      if (index >= uniqueSorted.length) {
        return fn();
      }
      return withMysqlNamedLock(
        this.connection,
        this.hierarchyLockName(uniqueSorted[index]),
        () => acquire(index + 1),
        timeoutSeconds,
      );
    };

    return acquire(0);
  }
}
