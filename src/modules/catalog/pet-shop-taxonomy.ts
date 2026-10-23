/**
 * Local pet-shop canonical leaves for the controlled Trendyol import.
 * Source category ids stay on `category`. One `any` mapping per source id.
 * Category 145 already has an `any` row (wrong shoe destination) and is retargeted.
 */
export const PET_SHOP_ROOT_NAME = 'پت‌شاپ';

export type PetShopLeaf = {
  sourceCategoryId: number;
  sourceName: string;
  name: string;
  /** Existing genderSlice=any row must be updated, not inserted again. */
  retargetExistingAnySlice: boolean;
};

export const PET_SHOP_LEAVES: PetShopLeaf[] = [
  {
    sourceCategoryId: 145,
    sourceName: 'Dog Collars',
    name: 'قلاده، بند و هارنس',
    retargetExistingAnySlice: true,
  },
  {
    sourceCategoryId: 1023,
    sourceName: 'Cat and Dog Food and Water Containers',
    name: 'کاسه غذا و آب',
    retargetExistingAnySlice: false,
  },
  {
    sourceCategoryId: 1026,
    sourceName: 'Cat Toys',
    name: 'اسباب‌بازی گربه',
    retargetExistingAnySlice: false,
  },
  {
    sourceCategoryId: 1035,
    sourceName: 'Dog Toys',
    name: 'اسباب‌بازی سگ',
    retargetExistingAnySlice: false,
  },
  {
    sourceCategoryId: 1028,
    sourceName: 'Cat Brushes and Combs',
    name: 'برس و شانه',
    retargetExistingAnySlice: false,
  },
  {
    sourceCategoryId: 1030,
    sourceName: 'Cat and Dog Bed',
    name: 'بستر و تشک',
    retargetExistingAnySlice: false,
  },
  {
    sourceCategoryId: 1032,
    sourceName: 'Cat & Dog Carrying Bags',
    name: 'باکس حمل',
    retargetExistingAnySlice: false,
  },
];

export function assertUniquePetShopTaxonomy(leaves: PetShopLeaf[] = PET_SHOP_LEAVES): void {
  const ids = new Set<number>();
  const names = new Set<string>();
  for (const leaf of leaves) {
    if (ids.has(leaf.sourceCategoryId)) {
      throw new Error(`duplicate source category ${leaf.sourceCategoryId}`);
    }
    if (names.has(leaf.name)) {
      throw new Error(`duplicate canonical name ${leaf.name}`);
    }
    if (!/[\u0600-\u06FF]/.test(leaf.name)) {
      throw new Error(`canonical name is not Persian: ${leaf.name}`);
    }
    ids.add(leaf.sourceCategoryId);
    names.add(leaf.name);
  }
}
