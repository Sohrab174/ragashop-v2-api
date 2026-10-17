/**
 * Unresolved product gender review («نیازمند تعیین جنسیت»).
 *
 * The queue is the subset of those products whose source category is
 * gender-relevant or ambiguous. Household and kids categories are excluded.
 * Mapping-page "unknown" stays a raw null-gender count and can be larger.
 *
 * Gender classification (product.gender) is distinct from storefront routing
 * (source_category_mapping slices). Resolving gender never edits mappings;
 * the destination preview only reports where the shared canonical
 * eligibility resolver would route the product.
 */

import { ProductGender } from '../product/entities/product.entity';
import {
  CanonicalProductEligibility,
  isProductCanonicallyEligible,
} from './canonical-product-eligibility';

export const RESOLVABLE_PRODUCT_GENDERS: readonly ProductGender[] = [
  ProductGender.female,
  ProductGender.male,
  ProductGender.unisex,
];

export type GenderReviewScope = 'discoverable' | 'catalog';

export function unresolvedGenderSql(alias: string): string {
  return `(${alias}.gender IS NULL OR ${alias}.gender NOT IN ('female','male','unisex'))`;
}

export function parseGenderReviewScope(raw: unknown): GenderReviewScope {
  return raw === 'catalog' ? 'catalog' : 'discoverable';
}

export class GenderReviewValidationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_product'
      | 'invalid_gender'
      | 'already_resolved'
      | 'not_found'
      | 'not_applicable',
  ) {
    super(message);
    this.name = 'GenderReviewValidationError';
  }
}

export function parseGenderResolutionInput(input: {
  productId?: unknown;
  gender?: unknown;
}): { productId: number; gender: ProductGender } {
  const productId = Number(input?.productId);
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new GenderReviewValidationError(
      'شناسه محصول نامعتبر است.',
      'invalid_product',
    );
  }
  const gender = String(input?.gender ?? '').trim();
  if (!(RESOLVABLE_PRODUCT_GENDERS as readonly string[]).includes(gender)) {
    throw new GenderReviewValidationError(
      'جنسیت انتخاب‌شده نامعتبر است. فقط زنانه، مردانه یا یونیسکس مجاز است.',
      'invalid_gender',
    );
  }
  return { productId, gender: gender as ProductGender };
}

export type GenderDestinationTarget = {
  canonicalCategoryId: number;
  pathLabel: string;
};

export type GenderDestinationPreview = Record<
  'current' | 'female' | 'male' | 'unisex',
  GenderDestinationTarget[]
>;

/**
 * For each candidate gender, list mapped canonical destinations whose shared
 * eligibility (mapping slices + adult audience gate) would include the product.
 * `current` uses the product's unresolved gender (null).
 */
export function buildGenderDestinationPreview(
  product: { categoryId: number },
  eligibilities: Array<{
    eligibility: Pick<
      CanonicalProductEligibility,
      'clauses' | 'audienceGenders'
    >;
    target: GenderDestinationTarget;
  }>,
): GenderDestinationPreview {
  const pick = (gender: ProductGender | null) =>
    eligibilities
      .filter(({ eligibility }) =>
        isProductCanonicallyEligible(
          { categoryId: Number(product.categoryId), gender },
          eligibility as CanonicalProductEligibility,
        ),
      )
      .map(({ target }) => target);

  return {
    current: pick(null),
    female: pick(ProductGender.female),
    male: pick(ProductGender.male),
    unisex: pick(ProductGender.unisex),
  };
}
