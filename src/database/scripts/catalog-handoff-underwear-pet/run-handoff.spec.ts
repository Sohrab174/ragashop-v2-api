import { APPROVED_PET_SOURCE_IDS } from './manifest';
import { summarizeApprovedShowcaseRows } from './run-handoff';

function productRow(
  sourceId: string,
  hierarchy = 'Supermarket/Pet Shop Products/Cat',
) {
  return {
    id: Number(sourceId),
    sourceId,
    categoryId: 10,
    isCuratedExternalCatalog: 0,
    hierarchy,
  };
}

describe('catalog handoff showcase preflight', () => {
  it('reports missing approved showcase products as skipped without blocking', () => {
    const missingSourceId = APPROVED_PET_SOURCE_IDS[0];
    const rows = APPROVED_PET_SOURCE_IDS.slice(1).map((sourceId) =>
      productRow(sourceId),
    );

    const result = summarizeApprovedShowcaseRows(rows);

    expect(result).toMatchObject({
      approvedCount: 30,
      eligibleCount: 29,
      missingCount: 1,
      skippedCount: 1,
      eligibleSourceIds: APPROVED_PET_SOURCE_IDS.slice(1),
      missingSourceIds: [missingSourceId],
      skippedSourceIds: [missingSourceId],
      blockingConditions: [],
    });
  });

  it('keeps duplicate products and incorrect category relationships blocking', () => {
    const duplicateSourceId = APPROVED_PET_SOURCE_IDS[0];
    const wrongCategorySourceId = APPROVED_PET_SOURCE_IDS[1];
    const rows = [
      productRow(duplicateSourceId),
      productRow(duplicateSourceId),
      productRow(wrongCategorySourceId, 'Shoes/Women'),
    ];

    const result = summarizeApprovedShowcaseRows(rows);

    expect(result.eligibleSourceIds).toEqual([]);
    expect(result.missingCount).toBe(28);
    expect(result.skippedCount).toBe(30);
    expect(result.blockingConditions).toEqual([
      `approved sourceId=${duplicateSourceId}: duplicate active product rows=2`,
      `approved sourceId=${wrongCategorySourceId}: not under Pet Shop hierarchy (Shoes/Women)`,
    ]);
  });
});
