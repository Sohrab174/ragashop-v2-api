/**
 * PLP-2 dynamic filters — parse, apply, and facet contracts.
 *
 * Filterable-attribute rule (no isFilterable column in schema):
 * Reuse SP `sp_GetAttributesForFilter` heuristics, scoped to PLP eligible products:
 *   - attribute.name != 'مبدأ'
 *   - top N by COUNT(DISTINCT productId) in the eligible scope
 *   - attribute_value.name length <= 30
 * Values/brands with zero relevant products are omitted (unless selected).
 *
 * Semantics:
 *   within one facet group → OR
 *   across facet groups    → AND
 * Facet counts: apply other active groups; exclude the facet being counted
 * (self-excluding refinement). Attribute filters also enforce AttributeValue
 * ownership: av.attributeId must equal the supplied group attributeId.
 */

import { STOREFRONT_EFFECTIVE_PRICE_SQL } from './storefront-plp.pricing';

export const STOREFRONT_PLP_MAX_BRAND_IDS = 40;
export const STOREFRONT_PLP_MAX_ATTR_GROUPS = 20;
export const STOREFRONT_PLP_MAX_VALUES_PER_ATTR = 40;
export const STOREFRONT_PLP_MAX_FACET_ATTRIBUTES = 20;
export const STOREFRONT_PLP_MAX_VALUE_NAME_LENGTH = 30;
/** Cap brand facet rows returned (largest counts first); selected brands always kept. */
export const STOREFRONT_PLP_MAX_BRAND_FACETS = 100;
/** Attribute names excluded from storefront filters (legacy SP rule). */
export const STOREFRONT_PLP_EXCLUDED_ATTRIBUTE_NAMES = ['مبدأ'] as const;

export type StorefrontPlpAttributeSelection = {
  attributeId: number;
  valueIds: number[];
};

export type StorefrontPlpFilters = {
  brandIds: number[];
  /** Customer-facing toman (nullable = unset). */
  minPrice: number | null;
  maxPrice: number | null;
  attributes: StorefrontPlpAttributeSelection[];
};

export type StorefrontPlpBrandFacet = {
  id: number;
  name: string;
  count: number;
};

export type StorefrontPlpPriceFacet = {
  min: number | null;
  max: number | null;
};

export type StorefrontPlpAttributeValueFacet = {
  id: number;
  name: string;
  count: number;
};

export type StorefrontPlpAttributeFacet = {
  id: number;
  name: string;
  type: string;
  values: StorefrontPlpAttributeValueFacet[];
};

export type StorefrontPlpFiltersPayload = {
  brands: StorefrontPlpBrandFacet[];
  price: StorefrontPlpPriceFacet;
  attributes: StorefrontPlpAttributeFacet[];
};

export type StorefrontPlpAppliedFilters = {
  brands: number[];
  minPrice: number | null;
  maxPrice: number | null;
  attributes: StorefrontPlpAttributeSelection[];
};

export function emptyStorefrontPlpFilters(): StorefrontPlpFilters {
  return {
    brandIds: [],
    minPrice: null,
    maxPrice: null,
    attributes: [],
  };
}

export function emptyStorefrontPlpFiltersPayload(): StorefrontPlpFiltersPayload {
  return {
    brands: [],
    price: { min: null, max: null },
    attributes: [],
  };
}

function parsePositiveIntList(raw: unknown, max: number): number[] {
  if (raw == null || raw === '') return [];
  const text = Array.isArray(raw) ? raw.join(',') : String(raw);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const part of text.split(/[,]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= max) break;
  }
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Customer price filter bounds (toman).
 * 0 is NOT a meaningful selection — treat as unset (avoids phantom 0–0 chips).
 */
function parsePositiveMoney(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Parse attrs URL/API form: `12:44,45;18:91`
 * Groups sorted by attributeId; values sorted; invalid tokens ignored.
 */
export function parseStorefrontPlpAttributesParam(
  raw: unknown,
): StorefrontPlpAttributeSelection[] {
  if (raw == null || raw === '') return [];
  const text = Array.isArray(raw) ? raw.join(';') : String(raw);
  const byAttr = new Map<number, Set<number>>();

  for (const groupRaw of text.split(';')) {
    const group = groupRaw.trim();
    if (!group) continue;
    const colon = group.indexOf(':');
    if (colon <= 0) continue;
    const attrId = Number(group.slice(0, colon).trim());
    if (!Number.isFinite(attrId) || !Number.isInteger(attrId) || attrId <= 0) {
      continue;
    }
    if (!byAttr.has(attrId) && byAttr.size >= STOREFRONT_PLP_MAX_ATTR_GROUPS) {
      continue;
    }
    const valueSet = byAttr.get(attrId) ?? new Set<number>();
    const valuesPart = group.slice(colon + 1);
    for (const vRaw of valuesPart.split(',')) {
      const v = Number(vRaw.trim());
      if (!Number.isFinite(v) || !Number.isInteger(v) || v <= 0) continue;
      if (valueSet.size >= STOREFRONT_PLP_MAX_VALUES_PER_ATTR) break;
      valueSet.add(v);
    }
    if (valueSet.size) {
      byAttr.set(attrId, valueSet);
    }
  }

  return [...byAttr.entries()]
    .map(([attributeId, valueIds]) => ({
      attributeId,
      valueIds: [...valueIds].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.attributeId - b.attributeId);
}

export function serializeStorefrontPlpAttributesParam(
  attributes: StorefrontPlpAttributeSelection[],
): string {
  return [...attributes]
    .filter((g) => g.valueIds.length > 0)
    .sort((a, b) => a.attributeId - b.attributeId)
    .map(
      (g) =>
        `${g.attributeId}:${[...g.valueIds].sort((a, b) => a - b).join(',')}`,
    )
    .join(';');
}

export function parseStorefrontPlpFilters(input: {
  brands?: unknown;
  minPrice?: unknown;
  maxPrice?: unknown;
  attrs?: unknown;
  attributes?: unknown;
}): StorefrontPlpFilters {
  const brandIds = parsePositiveIntList(
    input.brands,
    STOREFRONT_PLP_MAX_BRAND_IDS,
  );
  let minPrice = parsePositiveMoney(input.minPrice);
  let maxPrice = parsePositiveMoney(input.maxPrice);

  // Invalid range → drop price filter (do not 500).
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    minPrice = null;
    maxPrice = null;
  }

  const attributes = parseStorefrontPlpAttributesParam(
    input.attrs ?? input.attributes,
  );

  return { brandIds, minPrice, maxPrice, attributes };
}

export function hasActiveStorefrontPlpFilters(
  filters: StorefrontPlpFilters,
): boolean {
  return (
    filters.brandIds.length > 0 ||
    filters.minPrice != null ||
    filters.maxPrice != null ||
    filters.attributes.some((g) => g.valueIds.length > 0)
  );
}

export function toAppliedStorefrontPlpFilters(
  filters: StorefrontPlpFilters,
): StorefrontPlpAppliedFilters {
  return {
    brands: [...filters.brandIds],
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    attributes: filters.attributes.map((g) => ({
      attributeId: g.attributeId,
      valueIds: [...g.valueIds],
    })),
  };
}

/**
 * Convert customer toman bounds → TRY for SQL against effective sell price.
 * Filtering happens AFTER conceptual TRY→toman display (inverse of mapper).
 */
export function tomanBoundsToTry(
  minToman: number | null,
  maxToman: number | null,
  tryToToman: number,
): { minTry: number | null; maxTry: number | null } {
  const rate = Number.isFinite(tryToToman) && tryToToman > 0 ? tryToToman : 1;
  return {
    minTry: minToman != null ? minToman / rate : null,
    maxTry: maxToman != null ? maxToman / rate : null,
  };
}

export function tryPriceToToman(
  tryPrice: number | null | undefined,
  tryToToman: number,
): number | null {
  if (tryPrice == null || !Number.isFinite(Number(tryPrice))) return null;
  const rate = Number.isFinite(tryToToman) && tryToToman > 0 ? tryToToman : 1;
  return Math.round(Number(tryPrice) * rate);
}

type FilterableQueryBuilder = {
  andWhere: (where: string, params?: Record<string, unknown>) => unknown;
};

export type ApplyStorefrontFiltersOptions = {
  /** When set, skip brand IN clause (for brand facet counts). */
  skipBrands?: boolean;
  /** When set, skip price bounds (for price facet). */
  skipPrice?: boolean;
  /**
   * Attribute id whose selection should be ignored (self-facet exclusion).
   * Pass `true` to skip ALL attribute filters.
   */
  skipAttributeId?: number | true;
};

/**
 * Apply brand / price / attribute filters to a product query builder.
 * Attribute groups use EXISTS so pagination totals stay DISTINCT products.
 */
export function applyStorefrontPlpFilters(
  builder: FilterableQueryBuilder,
  filters: StorefrontPlpFilters,
  tryToToman: number,
  options: ApplyStorefrontFiltersOptions = {},
): void {
  if (!options.skipBrands && filters.brandIds.length > 0) {
    builder.andWhere('product.brandId IN (:...plpBrandIds)', {
      plpBrandIds: filters.brandIds,
    });
  }

  if (!options.skipPrice) {
    const { minTry, maxTry } = tomanBoundsToTry(
      filters.minPrice,
      filters.maxPrice,
      tryToToman,
    );
    if (minTry != null) {
      builder.andWhere(`${STOREFRONT_EFFECTIVE_PRICE_SQL} >= :plpMinTry`, {
        plpMinTry: minTry,
      });
    }
    if (maxTry != null) {
      builder.andWhere(`${STOREFRONT_EFFECTIVE_PRICE_SQL} <= :plpMaxTry`, {
        plpMaxTry: maxTry,
      });
    }
  }

  if (options.skipAttributeId === true) {
    return;
  }

  const groups = filters.attributes.filter((g) => {
    if (!g.valueIds.length) return false;
    if (
      options.skipAttributeId != null &&
      options.skipAttributeId !== true &&
      g.attributeId === options.skipAttributeId
    ) {
      return false;
    }
    return true;
  });

  for (const group of groups) {
    const paramKey = `plpAttrVals_${group.attributeId}`;
    const attrParamKey = `plpAttrId_${group.attributeId}`;
    // Ownership: AttributeValue.attributeId must equal the supplied group id.
    // Drive from attributeValueId (selective index) rather than correlated
    // EXISTS-per-product, which re-scans PAV across large eligible scopes.
    builder.andWhere(
      `product.id IN (
        SELECT pav_f.productId
        FROM product_attribute_value pav_f
        INNER JOIN attribute_value av_f
          ON av_f.id = pav_f.attributeValueId
         AND av_f.attributeId = :${attrParamKey}
        WHERE pav_f.isDeleted = 0
          AND pav_f.attributeValueId IN (:...${paramKey})
      )`,
      {
        [attrParamKey]: group.attributeId,
        [paramKey]: group.valueIds,
      },
    );
  }
}

export function isExcludedFilterAttributeName(
  name: string | null | undefined,
): boolean {
  const n = String(name || '').trim();
  return (
    STOREFRONT_PLP_EXCLUDED_ATTRIBUTE_NAMES as readonly string[]
  ).includes(n);
}

/**
 * Drop AttributeValue ids that do not belong to the supplied attributeId.
 * Mirrors URL parser behavior: invalid tokens/groups are ignored (not remapped).
 * A fully foreign group disappears; remaining valid groups still AND together.
 */
export function sanitizeStorefrontPlpAttributeOwnership(
  attributes: StorefrontPlpAttributeSelection[],
  ownership: ReadonlyMap<number, number>,
): StorefrontPlpAttributeSelection[] {
  const out: StorefrontPlpAttributeSelection[] = [];
  for (const group of attributes) {
    if (!group.valueIds.length) continue;
    const valueIds = group.valueIds.filter(
      (valueId) => ownership.get(valueId) === group.attributeId,
    );
    if (!valueIds.length) continue;
    out.push({
      attributeId: group.attributeId,
      valueIds: [...valueIds].sort((a, b) => a - b),
    });
  }
  return out.sort((a, b) => a.attributeId - b.attributeId);
}
