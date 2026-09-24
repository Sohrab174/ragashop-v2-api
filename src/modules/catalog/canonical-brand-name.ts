/**
 * Canonical catalog brand display name for storefront surfaces.
 *
 * BrandEntity.name is often a Persian translation of sourceName (retailer brand).
 * Storefront must prefer sourceName so names like Stradivarius / MANGO Woman / Nike
 * stay canonical — never auto-translated for customer-facing cards.
 */
export function canonicalBrandName(
  brand:
    | {
        name?: string | null;
        sourceName?: string | null;
      }
    | null
    | undefined,
): string | null {
  const source = brand?.sourceName?.trim() || "";
  const name = brand?.name?.trim() || "";
  if (source) return source;
  if (name) return name;
  return null;
}
