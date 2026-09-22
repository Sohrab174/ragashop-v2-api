import { CategoryEntity, CategoryStatus } from './entities/category.entity';
import { FindOneOptions } from 'typeorm';

export class CategoryHierarchyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CategoryHierarchyValidationError';
  }
}

/**
 * Reject missing parent, self-parent, and direct/indirect cycles before write.
 * Does not repair historical orphan-parent rows.
 */
export async function validateCategoryParentAssignment(
  categoryRepository: {
    findOne: (
      options: FindOneOptions<CategoryEntity>,
    ) => Promise<CategoryEntity | undefined>;
  },
  categoryId: number | null | undefined,
  parentId: number | null | undefined,
): Promise<void> {
  if (parentId == null) {
    return;
  }

  if (categoryId != null && parentId === categoryId) {
    throw new CategoryHierarchyValidationError(
      'Category cannot be its own parent',
    );
  }

  const parent = await categoryRepository.findOne({
    where: { id: parentId },
    select: ['id', 'parentId', 'status'],
  });

  if (!parent || parent.status === CategoryStatus.inactive) {
    throw new CategoryHierarchyValidationError(
      'Parent category does not exist',
    );
  }

  let cursor: Pick<CategoryEntity, 'id' | 'parentId'> | undefined = parent;
  const visited = new Set<number>([parent.id]);

  while (cursor?.parentId) {
    if (categoryId != null && cursor.parentId === categoryId) {
      throw new CategoryHierarchyValidationError(
        'Category parent assignment would create a cycle',
      );
    }

    if (visited.has(cursor.parentId)) {
      throw new CategoryHierarchyValidationError(
        'Category parent chain contains a cycle',
      );
    }
    visited.add(cursor.parentId);

    cursor = await categoryRepository.findOne({
      where: { id: cursor.parentId },
      select: ['id', 'parentId'],
    });

    if (!cursor) {
      throw new CategoryHierarchyValidationError(
        'Parent category does not exist',
      );
    }
  }
}
