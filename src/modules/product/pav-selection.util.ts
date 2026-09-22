/**
 * Deterministic PAV selection — mirrored from crawler for admin writes.
 * Logical write identity (productId, attributeValueId) applies to Trendyol-style
 * single-selection-attribute representation only.
 */

export interface PavRowLike {
  id: number;
  attributeValueId: number;
  isDeleted?: boolean;
  number?: string | null;
  quantity?: number | null;
  price?: number | null;
  discountedPrice?: number | null;
}

export function selectCanonicalActivePav(
  rows: PavRowLike[],
  referencedPavIds: ReadonlySet<number> = new Set(),
): PavRowLike | null {
  const active = (rows || []).filter((row) => !row.isDeleted);
  if (active.length === 0) {
    return null;
  }

  const referenced = active.filter((row) => referencedPavIds.has(row.id));
  if (referenced.length === 1) {
    return referenced[0];
  }
  if (referenced.length > 1) {
    return [...referenced].sort((a, b) => a.id - b.id)[0];
  }

  return [...active].sort((a, b) => a.id - b.id)[0];
}

export function selectCanonicalInactivePav(
  rows: PavRowLike[],
  referencedPavIds: ReadonlySet<number> = new Set(),
): PavRowLike | null {
  const inactive = (rows || []).filter((row) => row.isDeleted);
  if (inactive.length === 0) {
    return null;
  }

  const referenced = inactive.filter((row) => referencedPavIds.has(row.id));
  if (referenced.length >= 1) {
    return [...referenced].sort((a, b) => a.id - b.id)[0];
  }

  return [...inactive].sort((a, b) => a.id - b.id)[0];
}
