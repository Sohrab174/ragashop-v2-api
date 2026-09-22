import {
  CanonicalCategoryEntity,
  CanonicalCategoryStatus,
} from './entities/canonical-category.entity';
import {
  CategoryEntity,
  CategoryStatus,
} from '../category/entities/category.entity';
import { SourceCategoryMappingStatus } from './entities/source-category-mapping.entity';
import { FindOneOptions } from 'typeorm';

export class SourceCategoryMappingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceCategoryMappingValidationError';
  }
}

type CategoryLookup = {
  findOne: (
    options: FindOneOptions<CategoryEntity>,
  ) => Promise<CategoryEntity | undefined>;
};

type MappingLookup = {
  findOne: (options: {
    where: { sourceCategoryId: number };
  }) => Promise<{ id: number; canonicalCategoryId: number } | undefined>;
};

/**
 * Validate a source→canonical mapping write.
 *
 * Identity: category.id (sourceCategoryId) is authoritative and unique.
 * `source` is denormalized metadata and MUST equal category.source.
 */
export async function validateSourceCategoryMappingWrite(
  categoryRepository: CategoryLookup,
  mappingRepository: MappingLookup,
  input: {
    sourceCategoryId: number;
    canonicalCategoryId: number;
    source?: string | null;
    /** When updating an existing row, exclude it from uniqueness check. */
    mappingId?: number | null;
  },
  canonicalRepository: {
    findOne: (
      options: FindOneOptions<CanonicalCategoryEntity>,
    ) => Promise<CanonicalCategoryEntity | undefined>;
  },
): Promise<{
  source: string;
  sourceCategoryId: number;
  canonicalCategoryId: number;
}> {
  const sourceCategoryId = Number(input.sourceCategoryId);
  const canonicalCategoryId = Number(input.canonicalCategoryId);

  if (!Number.isFinite(sourceCategoryId) || sourceCategoryId <= 0) {
    throw new SourceCategoryMappingValidationError(
      'sourceCategoryId is required',
    );
  }
  if (!Number.isFinite(canonicalCategoryId) || canonicalCategoryId <= 0) {
    throw new SourceCategoryMappingValidationError(
      'canonicalCategoryId is required',
    );
  }

  const category = await categoryRepository.findOne({
    where: { id: sourceCategoryId },
    select: ['id', 'source', 'status'],
  });

  if (!category) {
    throw new SourceCategoryMappingValidationError(
      'Source category does not exist',
    );
  }

  if (category.status === CategoryStatus.inactive) {
    throw new SourceCategoryMappingValidationError(
      'Source category is inactive',
    );
  }

  const authoritativeSource = category.source;
  if (!authoritativeSource) {
    throw new SourceCategoryMappingValidationError(
      'Source category has no source identity',
    );
  }

  if (
    input.source != null &&
    String(input.source) !== String(authoritativeSource)
  ) {
    throw new SourceCategoryMappingValidationError(
      'mapping.source must equal referenced category.source',
    );
  }

  const canonical = await canonicalRepository.findOne({
    where: { id: canonicalCategoryId },
    select: ['id', 'status'],
  });

  if (!canonical) {
    throw new SourceCategoryMappingValidationError(
      'Canonical category does not exist',
    );
  }

  if (canonical.status === CanonicalCategoryStatus.inactive) {
    throw new SourceCategoryMappingValidationError(
      'Canonical category is inactive',
    );
  }

  const existing = await mappingRepository.findOne({
    where: { sourceCategoryId },
  });

  if (
    existing &&
    (input.mappingId == null || existing.id !== input.mappingId) &&
    existing.canonicalCategoryId !== canonicalCategoryId
  ) {
    throw new SourceCategoryMappingValidationError(
      'Source category is already mapped to a different canonical category',
    );
  }

  return {
    source: authoritativeSource,
    sourceCategoryId,
    canonicalCategoryId,
  };
}

export { SourceCategoryMappingStatus };
