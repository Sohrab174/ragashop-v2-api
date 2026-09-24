import { ProductGender } from '../product/entities/product.entity';
import {
  conflictingProductGenderForAudience,
  eligibleProductGendersForAudience,
  isAdultAudienceBrowse,
  resolveCanonicalBrowseAudience,
  type CanonicalAudienceRow,
} from './canonical-audience-policy';

describe('canonical-audience-policy (CAT-3B)', () => {
  const tree: CanonicalAudienceRow[] = [
    { id: 1, parentId: null, name: 'زنانه', audience: 'female' },
    { id: 2, parentId: 1, name: 'پوشاک', audience: null },
    { id: 3, parentId: 2, name: 'کفش', audience: null },
    { id: 6, parentId: null, name: 'مردانه', audience: 'male' },
    { id: 7, parentId: 6, name: 'پیراهن', audience: null },
    { id: 11, parentId: null, name: 'بچگانه', audience: 'child' },
    { id: 12, parentId: 11, name: 'پوشاک', audience: null },
    { id: 99, parentId: null, name: 'زیبایی', audience: null },
  ];

  it('resolves women root and nested to women', () => {
    expect(resolveCanonicalBrowseAudience(1, tree)).toBe('women');
    expect(resolveCanonicalBrowseAudience(3, tree)).toBe('women');
  });

  it('resolves men root and nested to men', () => {
    expect(resolveCanonicalBrowseAudience(6, tree)).toBe('men');
    expect(resolveCanonicalBrowseAudience(7, tree)).toBe('men');
  });

  it('resolves kids to kids (not adult gender filter)', () => {
    expect(resolveCanonicalBrowseAudience(11, tree)).toBe('kids');
    expect(resolveCanonicalBrowseAudience(12, tree)).toBe('kids');
    expect(isAdultAudienceBrowse('kids')).toBe(false);
  });

  it('resolves beauty/neutral without adult filter', () => {
    expect(resolveCanonicalBrowseAudience(99, tree)).toBe('neutral');
    expect(isAdultAudienceBrowse('neutral')).toBe(false);
  });

  it('men eligible genders = male + unisex (fail-closed null)', () => {
    expect(eligibleProductGendersForAudience('men')).toEqual([
      ProductGender.male,
      ProductGender.unisex,
    ]);
    expect(conflictingProductGenderForAudience('men')).toBe(
      ProductGender.female,
    );
  });

  it('women eligible genders = female + unisex (fail-closed null)', () => {
    expect(eligibleProductGendersForAudience('women')).toEqual([
      ProductGender.female,
      ProductGender.unisex,
    ]);
    expect(conflictingProductGenderForAudience('women')).toBe(
      ProductGender.male,
    );
  });

  it('isAdultAudienceBrowse only for men/women', () => {
    expect(isAdultAudienceBrowse('men')).toBe(true);
    expect(isAdultAudienceBrowse('women')).toBe(true);
    expect(isAdultAudienceBrowse('kids')).toBe(false);
  });
});
