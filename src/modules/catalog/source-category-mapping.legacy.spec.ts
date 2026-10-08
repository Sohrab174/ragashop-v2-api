import {
  indexLegacyMappingsBySourceCategoryId,
  LEGACY_MAPPING_GENDER_SLICE,
  LEGACY_MAPPING_REVIEW_STATUS,
  selectLegacyMappingForSourceCategory,
} from './source-category-mapping.legacy';
import {
  SourceCategoryMappingGenderSlice,
  SourceCategoryMappingReviewStatus,
} from './entities/source-category-mapping.entity';

describe('source-category-mapping.legacy (CAT-MAP-V2-A)', () => {
  it('locks V1 writes to any + legacy_unreviewed', () => {
    expect(LEGACY_MAPPING_GENDER_SLICE).toBe(
      SourceCategoryMappingGenderSlice.any,
    );
    expect(LEGACY_MAPPING_REVIEW_STATUS).toBe(
      SourceCategoryMappingReviewStatus.legacy_unreviewed,
    );
  });

  it('prefers any slice when multiple rows exist for one source category', () => {
    const selected = selectLegacyMappingForSourceCategory(
      [
        {
          id: 2,
          sourceCategoryId: 17,
          genderSlice: SourceCategoryMappingGenderSlice.female,
        },
        {
          id: 5,
          sourceCategoryId: 17,
          genderSlice: SourceCategoryMappingGenderSlice.any,
        },
        {
          id: 1,
          sourceCategoryId: 17,
          genderSlice: SourceCategoryMappingGenderSlice.male,
        },
      ],
      17,
    );
    expect(selected?.id).toBe(5);
    expect(selected?.genderSlice).toBe('any');
  });

  it('indexes one legacy mapping per source category', () => {
    const map = indexLegacyMappingsBySourceCategoryId([
      {
        id: 1,
        sourceCategoryId: 10,
        genderSlice: SourceCategoryMappingGenderSlice.any,
      },
      {
        id: 2,
        sourceCategoryId: 11,
        genderSlice: SourceCategoryMappingGenderSlice.any,
      },
      {
        id: 3,
        sourceCategoryId: 10,
        genderSlice: SourceCategoryMappingGenderSlice.female,
      },
    ]);
    expect(map.size).toBe(2);
    expect(map.get(10)?.id).toBe(1);
    expect(map.get(11)?.id).toBe(2);
  });
});
