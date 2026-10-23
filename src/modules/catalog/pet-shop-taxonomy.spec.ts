import {
  assertUniquePetShopTaxonomy,
  PET_SHOP_LEAVES,
  PET_SHOP_ROOT_NAME,
} from './pet-shop-taxonomy';

describe('pet shop taxonomy plan', () => {
  it('maps seven source categories to distinct Persian leaves', () => {
    expect(PET_SHOP_ROOT_NAME).toBe('پت‌شاپ');
    expect(PET_SHOP_LEAVES).toHaveLength(7);
    expect(() => assertUniquePetShopTaxonomy()).not.toThrow();
  });

  it('retargets the existing dog-collar any-slice instead of inserting a second row', () => {
    const collars = PET_SHOP_LEAVES.find((leaf) => leaf.sourceCategoryId === 145);
    expect(collars?.retargetExistingAnySlice).toBe(true);
    expect(collars?.name).toBe('قلاده، بند و هارنس');
    const inserts = PET_SHOP_LEAVES.filter((leaf) => !leaf.retargetExistingAnySlice);
    expect(inserts).toHaveLength(6);
    expect(new Set(inserts.map((leaf) => leaf.sourceCategoryId)).size).toBe(6);
  });
});
