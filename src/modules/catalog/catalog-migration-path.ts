/**
 * Catalog migration path documentation.
 *
 * Current (PLP-2):
 *   Product → existing Category (imported source taxonomy)
 *   Storefront navigation: GET /catalog/navigation (canonical)
 *   Storefront listing: GET /catalog/products?categoryId={canonicalId}
 *     resolves canonical → active mappings → source descendants → Products
 *     + dynamic brand / price / attribute facets from the same eligible set
 *
 * Intermediate foundations:
 *   Source Category → Canonical Category via source_category_mapping
 *
 * Future:
 *   Canonical Product → multiple Offers (Trendyol / Beymen / Boyner / Amazon / …)
 *   Optional Product.canonicalCategoryId (not attached in PLP-1/2)
 */
export const CATALOG_MIGRATION_PATH = {
  phase: 'PLP-2',
  current:
    'Product → source Category; PLP via canonical resolution + dynamic facets',
  intermediate: 'Source Category → Canonical Category mapping',
  future: 'Canonical Product → multi-source Offers',
  listingEndpoint: 'GET /catalog/products',
  listingCategoryParam: 'canonical category id',
} as const;
