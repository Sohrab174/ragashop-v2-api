/**
 * SCOPE-3/4 — READ-ONLY check of Admin assortment metrics against the DB.
 *
 * Usage (from ragashop-api):
 *   npx ts-node -r tsconfig-paths/register src/modules/catalog/scripts/assortment-admin-readonly-check.ts
 *
 * SELECT only. Prints the IN-only AUTO-MAP coverage the Admin endpoints serve,
 * plus mapping-queue eligibility and legacy mapping classification.
 */
import { createConnection } from 'typeorm';
import { AssortmentAutoMapService } from '../assortment-policy/assortment-auto-map.service';
import {
  classifyLegacyMappingsByAssortment,
  isMappingEligibleStatus,
} from '../assortment-policy/assortment-auto-map.gate';

async function main() {
  const conn = await createConnection();
  try {
    const productRepoLike = { query: (sql: string) => conn.query(sql) };
    const service = new AssortmentAutoMapService(productRepoLike as any);
    const result = await service.computeAdmin();

    const resolutions: Array<{ categoryId: number; status: string }> =
      await conn.query(
        `SELECT categoryId, status FROM category_assortment_resolution`,
      );
    const statusById = new Map(
      resolutions.map((r) => [Number(r.categoryId), String(r.status)]),
    );
    const mappings: Array<{ id: number; sourceCategoryId: number; status: string }> =
      await conn.query(
        `SELECT id, sourceCategoryId, status FROM source_category_mapping`,
      );
    const legacy = classifyLegacyMappingsByAssortment({
      mappings,
      statusByCategoryId: statusById,
    });
    const mappedEligible = mappings.filter((m) =>
      isMappingEligibleStatus(statusById.get(Number(m.sourceCategoryId))),
    ).length;

    console.log(
      JSON.stringify(
        {
          policyVersion: result.policyVersion,
          coverage: result.coverage,
          inScopeByTier: result.inScopeByTier,
          nodesByGate: result.nodes.reduce((acc: Record<string, number>, n) => {
            acc[n.gate] = (acc[n.gate] || 0) + 1;
            return acc;
          }, {}),
          legacyMappingsByStatus: {
            IN_SCOPE: legacy.byStatus.IN_SCOPE.mappingIds,
            REVIEW_REQUIRED: legacy.byStatus.REVIEW_REQUIRED.mappingIds,
            OUT_OF_SCOPE: legacy.byStatus.OUT_OF_SCOPE.mappingIds,
            unresolvable: legacy.unresolvable,
          },
          mappingRowsOnMappingEligibleSources: mappedEligible,
        },
        null,
        2,
      ),
    );
  } finally {
    await conn.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
