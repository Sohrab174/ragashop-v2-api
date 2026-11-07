/**
 * Stable business identifiers for catalog handoff (underwear + pet curation).
 * Never use Local auto-increment mapping/product IDs for Production targeting.
 */

export const PROVIDER = 'trendyol' as const;

/** Trendyol Kombinezon — maps to women's underwear; must become inactive. */
export const KOMBINEZON_SOURCE_ID = '1099';
export const KOMBINEZON_SOURCE_NAME = 'Kombinezon';
export const KOMBINEZON_HIERARCHY = 'Giyim/İç Giyim/Kombinezon';

export const PET_HIERARCHY_PREFIX = 'Supermarket/Pet Shop Products%';

/** 30 owner-approved Pet Shop products (Trendyol sourceId). */
export const APPROVED_PET_SOURCE_IDS: readonly string[] = [
  '828442459',
  '896922859',
  '356581842',
  '689045728',
  '860390334',
  '1163395689',
  '816916498',
  '786715191',
  '1140106761',
  '374658514',
  '1178130220',
  '924154951',
  '948407017',
  '832472420',
  '206124228',
  '793505492',
  '887632406',
  '299433114',
  '78092993',
  '889128456',
  '928559432',
  '106965011',
  '203329574',
  '649648906',
  '844552870',
  '776977675',
  '868918147',
  '854167607',
  '214934057',
  '820207874',
] as const;

/** 13 manual-review + 1 rejected (805481396). Must remain uncurated. */
export const PROTECTED_PET_SOURCE_IDS: readonly string[] = [
  '837907153',
  '924094557',
  '864026854',
  '1054654088',
  '920942097',
  '814676711',
  '682297435',
  '821758872',
  '783260633',
  '820475562',
  '458692399',
  '6951650',
  '104262264',
  '805481396',
] as const;

export const REJECTED_PET_SOURCE_ID = '805481396';

export const REQUIRED_TABLES = [
  'source_category_mapping',
  'category',
  'canonical_category',
  'product',
] as const;

export const REQUIRED_COLUMNS: Record<string, readonly string[]> = {
  source_category_mapping: [
    'id',
    'source',
    'sourceCategoryId',
    'canonicalCategoryId',
    'genderSlice',
    'status',
    'note',
    'updatedAt',
  ],
  category: ['id', 'source', 'sourceId', 'sourceName', 'hierarchy', 'parentId'],
  canonical_category: ['id', 'name', 'parentId', 'status'],
  product: [
    'id',
    'source',
    'sourceId',
    'categoryId',
    'isCuratedExternalCatalog',
    'isDeleted',
  ],
};

/** Shoe-parent migration expected marketplace identities (unchanged guards). */
export const SHOE_SOURCE_IDS = ['1108', '104543', '101421', '113'] as const;
export const SHOE_ROOT_SOURCE_ID = '114';
export const DOG_COLLARS_SOURCE_ID = '1352';
export const BALLERINA_SOURCE_ID = '410';
export const BABET_SOURCE_ID = '113';

export function assertNoApprovedProtectedOverlap(): void {
  const approved = new Set(APPROVED_PET_SOURCE_IDS);
  const overlap = PROTECTED_PET_SOURCE_IDS.filter((id) => approved.has(id));
  if (overlap.length) {
    throw new Error(
      `manifest overlap between approved and protected sourceIds: ${overlap.join(',')}`,
    );
  }
  if (APPROVED_PET_SOURCE_IDS.length !== 30) {
    throw new Error(
      `approved set must be 30, got ${APPROVED_PET_SOURCE_IDS.length}`,
    );
  }
  if (PROTECTED_PET_SOURCE_IDS.length !== 14) {
    throw new Error(
      `protected set must be 14, got ${PROTECTED_PET_SOURCE_IDS.length}`,
    );
  }
  if (new Set(APPROVED_PET_SOURCE_IDS).size !== 30) {
    throw new Error('approved set has duplicate sourceIds');
  }
  if (new Set(PROTECTED_PET_SOURCE_IDS).size !== 14) {
    throw new Error('protected set has duplicate sourceIds');
  }
}
