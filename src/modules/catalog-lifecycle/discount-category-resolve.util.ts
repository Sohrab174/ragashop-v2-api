/**
 * Explicit English PDP → Turkish IN_SCOPE sourceName aliases.
 * Exact keys only — never fuzzy text similarity.
 */
export const TRENDYOL_SOURCE_CATEGORY_ALIASES: Readonly<Record<string, string>> =
  {
    Dresses: 'Elbise',
    Sweaters: 'Kazak',
    Trousers: 'Pantolon',
    Blouses: 'Bluz',
    Umbrellas: 'Şemsiye',
    Bracelets: 'Bilezik',
  };

export function normalizeTrendyolSourceCategoryName(
  sourceName?: string | null,
): string {
  const raw = String(sourceName || '').trim();
  if (!raw) return '';
  return TRENDYOL_SOURCE_CATEGORY_ALIASES[raw] || raw;
}

/** Confirmed Local category ids for supported Turkish leaves (ragashop_local). */
export const DISCOUNT_ENGINE_KNOWN_SOURCE_CATEGORY_IDS: Readonly<
  Record<string, number>
> = {
  Bluz: 13,
  Pantolon: 14,
  Elbise: 15,
  Kazak: 27,
  Sneaker: 81,
};

export function resolveKnownDiscountCategoryId(
  listingCategoryName?: string | null,
): number | null {
  const name = normalizeTrendyolSourceCategoryName(listingCategoryName);
  if (!name) return null;
  const id = DISCOUNT_ENGINE_KNOWN_SOURCE_CATEGORY_IDS[name];
  return id != null ? id : null;
}
