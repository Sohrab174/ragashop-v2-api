import {
  APPROVED_PET_SOURCE_IDS,
  PROTECTED_PET_SOURCE_IDS,
  REJECTED_PET_SOURCE_ID,
  assertNoApprovedProtectedOverlap,
} from './manifest';
import {
  buildPostApplyExpectation,
  buildPreApplyExpectation,
  summarizeApprovedShowcaseRows,
  summarizeProtectedRows,
} from './run-handoff';

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
  it('keeps the rejected item exclusively in the protected manifest', () => {
    expect(() => assertNoApprovedProtectedOverlap()).not.toThrow();
  });

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

  it('reports missing protected and rejected products without requiring fabricated rows', () => {
    const rows = PROTECTED_PET_SOURCE_IDS.filter(
      (sourceId) => sourceId !== REJECTED_PET_SOURCE_ID,
    ).map((sourceId) => productRow(sourceId));

    const result = summarizeProtectedRows(rows);

    expect(result).toMatchObject({
      protectedCount: PROTECTED_PET_SOURCE_IDS.length,
      presentCount: PROTECTED_PET_SOURCE_IDS.length - 1,
      missingCount: 1,
      skippedCount: 1,
      presentSourceIds: PROTECTED_PET_SOURCE_IDS.filter(
        (sourceId) => sourceId !== REJECTED_PET_SOURCE_ID,
      ),
      missingSourceIds: [REJECTED_PET_SOURCE_ID],
      blockingConditions: [],
    });
  });

  it('blocks duplicate, wrong-category, and curated protected rows together', () => {
    const duplicateSourceId = PROTECTED_PET_SOURCE_IDS[0];
    const wrongCategorySourceId = PROTECTED_PET_SOURCE_IDS[1];
    const curatedSourceId = PROTECTED_PET_SOURCE_IDS[2];
    const rows = [
      productRow(duplicateSourceId),
      productRow(duplicateSourceId),
      productRow(wrongCategorySourceId, 'Shoes/Women'),
      { ...productRow(curatedSourceId), isCuratedExternalCatalog: 1 },
    ];

    const result = summarizeProtectedRows(rows);

    expect(result.blockingConditions).toEqual([
      `protected sourceId=${duplicateSourceId}: duplicate active product rows=2`,
      `protected sourceId=${wrongCategorySourceId}: not under Pet Shop hierarchy (Shoes/Women)`,
      `protected sourceId=${curatedSourceId}: must be uncurated before apply (got curated=1)`,
    ]);
  });

  it('keeps apply and rollback expectations limited to captured existing products', () => {
    const approved = {
      id: 1,
      sourceId: APPROVED_PET_SOURCE_IDS[3],
      categoryId: 10,
      isCuratedExternalCatalog: 0,
      categorySourceId: 'pet-root',
      hierarchy: 'Supermarket/Pet Shop Products/Cat',
      role: 'approved' as const,
    };
    const protectedProduct = {
      ...productRow(PROTECTED_PET_SOURCE_IDS[4]),
      categorySourceId: 'pet-root',
      role: 'protected' as const,
    };
    const mappingPre = {
      id: 7,
      source: 'trendyol',
      sourceCategoryId: 8,
      canonicalCategoryId: 9,
      genderSlice: 'any',
      status: 'inactive',
      note: null,
      updatedAt: null,
      catSourceId: '1099',
      canonicalName: 'لباس زیر',
    };

    const postApply = buildPostApplyExpectation(
      mappingPre,
      [approved],
      [protectedProduct],
      null,
    );
    expect(postApply.approved.map((product) => product.sourceId)).toEqual([
      approved.sourceId,
    ]);
    expect(postApply.protected.map((product) => product.sourceId)).toEqual([
      protectedProduct.sourceId,
    ]);

    const preApply = buildPreApplyExpectation({
      mappingPre,
      approvedProductsPre: [approved],
      protectedProductsPre: [protectedProduct],
    } as Parameters<typeof buildPreApplyExpectation>[0]);
    expect(preApply.approved).toMatchObject([
      { sourceId: approved.sourceId, isCuratedExternalCatalog: 0 },
    ]);
    expect(preApply.protected).toMatchObject([
      { sourceId: protectedProduct.sourceId, isCuratedExternalCatalog: 0 },
    ]);
  });
});
