import {
  CanonicalCategoryEntity,
  CanonicalCategoryStatus,
} from './entities/canonical-category.entity';
import { FindOneOptions } from 'typeorm';

export class CanonicalHierarchyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalHierarchyValidationError';
  }
}

type CanonicalParentRepo = {
  findOne: (
    options: FindOneOptions<CanonicalCategoryEntity>,
  ) => Promise<CanonicalCategoryEntity | undefined>;
};

/**
 * Reject missing parent, inactive parent, self-parent, and cycles before write.
 */
export async function validateCanonicalParentAssignment(
  repository: CanonicalParentRepo,
  categoryId: number | null | undefined,
  parentId: number | null | undefined,
): Promise<void> {
  if (parentId == null) {
    return;
  }

  if (categoryId != null && parentId === categoryId) {
    throw new CanonicalHierarchyValidationError(
      'Canonical category cannot be its own parent',
    );
  }

  const parent = await repository.findOne({
    where: { id: parentId },
    select: ['id', 'parentId', 'status'],
  });

  if (!parent) {
    throw new CanonicalHierarchyValidationError(
      'Parent canonical category does not exist',
    );
  }

  if (parent.status === CanonicalCategoryStatus.inactive) {
    throw new CanonicalHierarchyValidationError(
      'Parent canonical category is inactive',
    );
  }

  let cursor: Pick<CanonicalCategoryEntity, 'id' | 'parentId'> | undefined =
    parent;
  const visited = new Set<number>([parent.id]);

  while (cursor?.parentId) {
    if (categoryId != null && cursor.parentId === categoryId) {
      throw new CanonicalHierarchyValidationError(
        'Canonical parent assignment would create a cycle',
      );
    }

    if (visited.has(cursor.parentId)) {
      throw new CanonicalHierarchyValidationError(
        'Canonical parent chain contains a cycle',
      );
    }
    visited.add(cursor.parentId);

    cursor = await repository.findOne({
      where: { id: cursor.parentId },
      select: ['id', 'parentId'],
    });

    if (!cursor) {
      throw new CanonicalHierarchyValidationError(
        'Parent canonical category does not exist',
      );
    }
  }
}
