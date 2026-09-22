import { ProductStatus } from './entities/product.entity';

/** Coherent deletion transition: product is no longer customer-visible. */
export const PRODUCT_DELETION_PATCH = {
  isDeleted: true,
  status: ProductStatus.inactive,
  coverId: null,
} as const;

export type ProductLifecycleSnapshot = {
  isDeleted?: boolean;
  status?: ProductStatus | string;
};

/**
 * Deleted Products cannot receive customer-visible child mutations or implicit reactivation.
 * Restore/reactivation is a separate explicit future operation.
 */
export function isProductEligibleForChildMutation(
  product: ProductLifecycleSnapshot | null | undefined,
): boolean {
  return !!product && product.isDeleted === false;
}

/** Crawler import/enrichment may upgrade stubs but must not resurrect deleted Products. */
export function isProductEligibleForCrawlerMutation(
  product: ProductLifecycleSnapshot | null | undefined,
): boolean {
  return isProductEligibleForChildMutation(product);
}

export function assertProductEligibleForChildMutation(
  product: ProductLifecycleSnapshot | null | undefined,
  error: { unprocessableEntity: (messages: string[]) => void },
): void {
  if (!isProductEligibleForChildMutation(product)) {
    error.unprocessableEntity(['محصول حذف شده است.']);
  }
}

/** Guard conditional Product updates from overwriting deletion. */
export function productUpdateEligibilityWhere(productId: number) {
  return { id: productId, isDeleted: false };
}

/** Exclude deleted Products from group/bulk activation and lifecycle mutations. */
export function groupMutationEligibilityWhere() {
  return { isDeleted: false };
}
