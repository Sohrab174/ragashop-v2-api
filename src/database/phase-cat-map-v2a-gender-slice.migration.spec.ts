/**
 * Pure migration safety contracts for CAT-MAP-V2-A.
 * Does not open a DB connection.
 * Kept outside src/database/migrations so TypeORM CLI does not load it.
 */

describe('phaseCatMapV2aGenderSlice migration contracts', () => {
  const detectMultiSliceGroups = (
    rows: Array<{ sourceCategoryId: number; genderSlice: string; id: number }>,
  ) => {
    const bySource = new Map<number, typeof rows>();
    for (const row of rows) {
      const list = bySource.get(row.sourceCategoryId) || [];
      list.push(row);
      bySource.set(row.sourceCategoryId, list);
    }
    return [...bySource.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([sourceCategoryId, list]) => ({
        sourceCategoryId,
        cnt: list.length,
        slices: list.map((r) => r.genderSlice).sort(),
      }));
  };

  it('allows one any row per source category (post-backfill V2-A state)', () => {
    const groups = detectMultiSliceGroups([
      { id: 1, sourceCategoryId: 13, genderSlice: 'any' },
      { id: 2, sourceCategoryId: 18, genderSlice: 'any' },
    ]);
    expect(groups).toEqual([]);
  });

  it('detects multi-slice groups that must block down()', () => {
    const groups = detectMultiSliceGroups([
      { id: 1, sourceCategoryId: 17, genderSlice: 'any' },
      { id: 2, sourceCategoryId: 17, genderSlice: 'female' },
      { id: 3, sourceCategoryId: 18, genderSlice: 'any' },
    ]);
    expect(groups).toEqual([
      { sourceCategoryId: 17, cnt: 2, slices: ['any', 'female'] },
    ]);
  });

  it('documents unique key evolution', () => {
    const before = ['sourceCategoryId'];
    const after = ['sourceCategoryId', 'genderSlice'];
    expect(after).toEqual(expect.arrayContaining(before));
    expect(after).toHaveLength(2);
  });

  it('documents backfill semantics for existing rows', () => {
    const migrated = {
      sourceCategoryId: 13,
      canonicalCategoryId: 20,
      genderSlice: 'any',
      reviewStatus: 'legacy_unreviewed',
      status: 'active',
    };
    expect(migrated.genderSlice).toBe('any');
    expect(migrated.reviewStatus).toBe('legacy_unreviewed');
    expect(migrated.canonicalCategoryId).toBe(20);
  });
});
