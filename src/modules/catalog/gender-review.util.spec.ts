import { ProductGender } from '../product/entities/product.entity';
import { SourceCategoryMappingGenderSlice } from './entities/source-category-mapping.entity';
import {
  buildGenderDestinationPreview,
  GenderReviewValidationError,
  parseGenderResolutionInput,
  parseGenderReviewScope,
  unresolvedGenderSql,
} from './gender-review.util';

describe('gender-review util', () => {
  it('unresolvedGenderSql matches NULL and non-enum values', () => {
    expect(unresolvedGenderSql('p')).toContain('p.gender IS NULL');
    expect(unresolvedGenderSql('p')).toContain("'female','male','unisex'");
  });

  it('parseGenderReviewScope defaults to discoverable', () => {
    expect(parseGenderReviewScope(undefined)).toBe('discoverable');
    expect(parseGenderReviewScope('catalog')).toBe('catalog');
    expect(parseGenderReviewScope('other')).toBe('discoverable');
  });

  it('parseGenderResolutionInput accepts only female/male/unisex', () => {
    expect(parseGenderResolutionInput({ productId: 12, gender: 'female' })).toEqual(
      { productId: 12, gender: ProductGender.female },
    );
    expect(() =>
      parseGenderResolutionInput({ productId: 12, gender: 'child' }),
    ).toThrow(GenderReviewValidationError);
    expect(() =>
      parseGenderResolutionInput({ productId: 12, gender: null }),
    ).toThrow(GenderReviewValidationError);
    expect(() =>
      parseGenderResolutionInput({ productId: 'x', gender: 'male' }),
    ).toThrow(GenderReviewValidationError);
  });

  it('destination preview keeps unresolved out of adult gender slices', () => {
    const womenEligibility = {
      clauses: [
        {
          slice: SourceCategoryMappingGenderSlice.female,
          sourceCategoryIds: [100],
          genders: [ProductGender.female, ProductGender.unisex],
        },
      ],
      audienceGenders: [ProductGender.female, ProductGender.unisex],
    };
    const menEligibility = {
      clauses: [
        {
          slice: SourceCategoryMappingGenderSlice.male,
          sourceCategoryIds: [100],
          genders: [ProductGender.male, ProductGender.unisex],
        },
      ],
      audienceGenders: [ProductGender.male, ProductGender.unisex],
    };
    const legacyAnyKids = {
      clauses: [
        {
          slice: SourceCategoryMappingGenderSlice.any,
          sourceCategoryIds: [100],
          genders: null,
        },
      ],
      audienceGenders: null,
    };

    const preview = buildGenderDestinationPreview(
      { categoryId: 100 },
      [
        {
          eligibility: womenEligibility,
          target: { canonicalCategoryId: 1, pathLabel: 'زنانه / بلوز' },
        },
        {
          eligibility: menEligibility,
          target: { canonicalCategoryId: 2, pathLabel: 'مردانه / پیراهن' },
        },
        {
          eligibility: legacyAnyKids,
          target: { canonicalCategoryId: 3, pathLabel: 'کودک / لباس' },
        },
      ],
    );

    expect(preview.current.map((t) => t.canonicalCategoryId)).toEqual([3]);
    expect(preview.female.map((t) => t.canonicalCategoryId)).toEqual([1, 3]);
    expect(preview.male.map((t) => t.canonicalCategoryId)).toEqual([2, 3]);
    expect(preview.unisex.map((t) => t.canonicalCategoryId)).toEqual([1, 2, 3]);
  });
});
