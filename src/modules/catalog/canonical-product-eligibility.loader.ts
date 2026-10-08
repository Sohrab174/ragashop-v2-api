import { EntityManager } from 'typeorm';
import { CategoryEntity } from '../category/entities/category.entity';
import { isAssortmentDiscoveryEnforcementEnabled } from './assortment-policy/assortment-enforcement';
import { CategoryAssortmentResolutionEntity } from './assortment-policy/entities/category-assortment-resolution.entity';
import {
  CanonicalEligibilityData,
  CanonicalProductEligibility,
  isCatalogMappingV2SliceRoutingEnabled,
  resolveCanonicalProductEligibility,
} from './canonical-product-eligibility';
import { CanonicalCategoryEntity } from './entities/canonical-category.entity';
import { SourceCategoryMappingEntity } from './entities/source-category-mapping.entity';

/** Bounded, set-based load (3–4 queries) shared by PLP and Search. */
export async function loadCanonicalEligibilityData(
  manager: EntityManager,
): Promise<CanonicalEligibilityData> {
  const loadAssortment = isAssortmentDiscoveryEnforcementEnabled();
  const [canonicalRows, mappings, sourceTaxonomy, assortmentRows] =
    await Promise.all([
      manager.find(CanonicalCategoryEntity, {
        select: [
          'id',
          'parentId',
          'status',
          'displayOrder',
          'name',
          'audience',
        ],
        order: { displayOrder: 'ASC', id: 'ASC' },
      }),
      manager.find(SourceCategoryMappingEntity, {
        select: [
          'id',
          'canonicalCategoryId',
          'sourceCategoryId',
          'status',
          'source',
          'genderSlice',
          'reviewStatus',
        ],
        order: { source: 'ASC', sourceCategoryId: 'ASC', id: 'ASC' },
      }),
      manager.find(CategoryEntity, {
        select: ['id', 'parentId', 'source', 'status', 'displayOrder', 'name'],
        order: { displayOrder: 'ASC', id: 'ASC' },
      }),
      loadAssortment
        ? manager.find(CategoryAssortmentResolutionEntity, {
            select: ['categoryId', 'status'],
          })
        : Promise.resolve([] as CategoryAssortmentResolutionEntity[]),
    ]);

  const assortmentStatusByCategoryId = loadAssortment
    ? new Map(
        assortmentRows.map((r) => [Number(r.categoryId), String(r.status)]),
      )
    : undefined;

  return {
    canonicalRows: canonicalRows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      status: row.status,
      displayOrder: row.displayOrder,
      name: row.name,
      audience: row.audience,
    })),
    mappings: mappings.map((m) => ({
      id: m.id,
      canonicalCategoryId: m.canonicalCategoryId,
      sourceCategoryId: m.sourceCategoryId,
      status: m.status,
      source: m.source,
      genderSlice: m.genderSlice,
      reviewStatus: m.reviewStatus,
    })),
    sourceTaxonomy: sourceTaxonomy.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      source: row.source,
      status: row.status,
      displayOrder: row.displayOrder,
      name: row.name,
    })),
    assortmentStatusByCategoryId,
  };
}

export function resolveCanonicalProductEligibilityFromData(
  canonicalCategoryId: number,
  data: CanonicalEligibilityData,
): CanonicalProductEligibility {
  return resolveCanonicalProductEligibility(canonicalCategoryId, data, {
    sliceRoutingEnabled: isCatalogMappingV2SliceRoutingEnabled(),
  });
}
