/**
 * Customer-facing Product Detail contract (PDP-1).
 * Source-agnostic — no retailer/source taxonomy leakage.
 */

export type StorefrontPdpBreadcrumbItem = {
  id: number;
  name: string;
};

export type StorefrontPdpImage = {
  id: number | null;
  path: string;
};

export type StorefrontPdpOptionValue = {
  /** product_attribute_value.id — required for future cart line */
  id: number;
  label: string;
  /** Hex / secondary swatch when present (e.g. color) */
  swatch: string | null;
  available: boolean;
  /** Effective sell price (toman) for this option when it carries its own price */
  price: number | null;
  compareAtPrice: number | null;
  discount: number | null;
};

export type StorefrontPdpOptionGroup = {
  attributeId: number;
  name: string;
  type: string;
  required: true;
  values: StorefrontPdpOptionValue[];
};

export type StorefrontPdpAttributeRow = {
  attributeId: number;
  name: string;
  value: string;
};

export type StorefrontPdpSibling = {
  id: number;
  name: string;
  image: string | null;
  label: string | null;
  swatch: string | null;
};

export type StorefrontPdpAvailability = {
  /** Customer-facing stock state for the product (before option pick). */
  status: 'in_stock' | 'low_stock' | 'out_of_stock';
  /** True when the product can be purchased after valid option selection. */
  purchasable: boolean;
  sourceVerificationRequired?: boolean;
  /** Remaining quantity when finite and known; null when unlimited / unknown. */
  quantity: number | null;
  /**
   * SCOPE-5/6 — customer-safe assortment hold (no policy enums).
   * Present only when commerce enforcement blocks purchase.
   */
  assortmentState?: 'review_required' | 'unavailable';
  assortmentMessage?: string;
};

export type StorefrontPdpProduct = {
  id: number;
  sourceUrl?: string | null;
  name: string;
  brand: string | null;
  breadcrumb: StorefrontPdpBreadcrumbItem[];
  images: StorefrontPdpImage[];
  /** Current customer price (toman) — product-level, before option override. */
  price: number;
  compareAtPrice: number | null;
  discount: number | null;
  availability: StorefrontPdpAvailability;
  /** Multi-value purchasable option groups (typically size). */
  options: StorefrontPdpOptionGroup[];
  /** Single-value descriptive attributes. */
  attributes: StorefrontPdpAttributeRow[];
  /** Plain-text description paragraphs (HTML stripped). */
  description: string | null;
  /**
   * Same-group sibling products (often color). Separate product pages —
   * not cart options. Empty when none.
   */
  siblings: StorefrontPdpSibling[];
};
